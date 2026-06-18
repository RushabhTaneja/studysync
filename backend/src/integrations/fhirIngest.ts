import { query } from "../db/pool.js";
import { fhirRead, fhirSearchAll } from "./smartFhir.js";

const US_CORE_RACE = "http://hl7.org/fhir/us/core/StructureDefinition/us-core-race";
const US_CORE_ETHNICITY = "http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity";

function extensionText(resource: any, url: string): string | null {
  const ext = (resource?.extension ?? []).find((e: any) => e.url === url);
  if (!ext) return null;
  const display = (ext.extension ?? []).find((e: any) => e.url === "text")?.valueString;
  return display ?? null;
}

function firstCoding(cc: any): { system?: string; code?: string; display?: string } {
  const coding = cc?.coding?.[0] ?? {};
  return { system: coding.system, code: coding.code, display: cc?.text ?? coding.display };
}

/**
 * Pull the clinical record for a connected EHR and flatten it into the FHIR tables.
 * Returns counts + the timestamp of the most recent data point seen.
 */
export async function ingestEhr(opts: {
  participantAccountId: string;
  fhirBase: string;
  accessToken: string;
  patientId: string;
}): Promise<{ counts: Record<string, number>; lastDataAt: Date | null }> {
  const { participantAccountId, fhirBase, accessToken, patientId } = opts;
  let lastDataAt: Date | null = null;
  const touch = (d?: string | null) => {
    if (!d) return;
    const t = new Date(d);
    if (!isNaN(t.getTime()) && (!lastDataAt || t > lastDataAt)) lastDataAt = t;
  };

  // --- Patient (demographics) ---
  const patient = await fhirRead(fhirBase, accessToken, `Patient/${patientId}`);
  const name = patient.name?.[0] ?? {};
  await query(
    `INSERT INTO fhir_patient (participant_account_id, fhir_patient_id, family_name, given_name, gender, birth_date, race, ethnicity, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (participant_account_id) DO UPDATE SET
       fhir_patient_id = EXCLUDED.fhir_patient_id, family_name = EXCLUDED.family_name,
       given_name = EXCLUDED.given_name, gender = EXCLUDED.gender, birth_date = EXCLUDED.birth_date,
       race = EXCLUDED.race, ethnicity = EXCLUDED.ethnicity, raw = EXCLUDED.raw`,
    [
      participantAccountId,
      patient.id,
      name.family ?? null,
      (name.given ?? []).join(" ") || null,
      patient.gender ?? null,
      patient.birthDate ?? null,
      extensionText(patient, US_CORE_RACE),
      extensionText(patient, US_CORE_ETHNICITY),
      patient,
    ]
  );

  // --- Conditions ---
  const conditions = await fhirSearchAll(fhirBase, accessToken, `Condition?patient=${patientId}`);
  for (const c of conditions) {
    const { system, code, display } = firstCoding(c.code);
    const onset = c.onsetDateTime ?? c.onsetPeriod?.start ?? null;
    touch(onset || c.recordedDate);
    await query(
      `INSERT INTO fhir_condition (participant_account_id, fhir_id, code_system, code, display, clinical_status, onset_date, recorded_date, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (participant_account_id, fhir_id) DO UPDATE SET
         code = EXCLUDED.code, display = EXCLUDED.display, clinical_status = EXCLUDED.clinical_status,
         onset_date = EXCLUDED.onset_date, recorded_date = EXCLUDED.recorded_date, raw = EXCLUDED.raw`,
      [
        participantAccountId,
        c.id,
        system ?? null,
        code ?? null,
        display ?? null,
        c.clinicalStatus?.coding?.[0]?.code ?? null,
        onset ? onset.slice(0, 10) : null,
        c.recordedDate ? c.recordedDate.slice(0, 10) : null,
        c,
      ]
    );
  }

  // --- Medication requests ---
  const meds = await fhirSearchAll(fhirBase, accessToken, `MedicationRequest?patient=${patientId}`);
  for (const m of meds) {
    const cc = m.medicationCodeableConcept ?? null;
    const { system, code, display } = cc ? firstCoding(cc) : { system: undefined, code: undefined, display: m.medicationReference?.display };
    touch(m.authoredOn);
    await query(
      `INSERT INTO fhir_medication_request (participant_account_id, fhir_id, code_system, code, display, status, intent, authored_on, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (participant_account_id, fhir_id) DO UPDATE SET
         code = EXCLUDED.code, display = EXCLUDED.display, status = EXCLUDED.status,
         intent = EXCLUDED.intent, authored_on = EXCLUDED.authored_on, raw = EXCLUDED.raw`,
      [
        participantAccountId,
        m.id,
        system ?? null,
        code ?? null,
        display ?? null,
        m.status ?? null,
        m.intent ?? null,
        m.authoredOn ?? null,
        m,
      ]
    );
  }

  // --- Observations (labs + vitals) ---
  const observations = await fhirSearchAll(fhirBase, accessToken, `Observation?patient=${patientId}`);
  for (const o of observations) {
    const { system, code, display } = firstCoding(o.code);
    const vq = o.valueQuantity;
    const eff = o.effectiveDateTime ?? o.effectivePeriod?.start ?? null;
    touch(eff);
    await query(
      `INSERT INTO fhir_observation (participant_account_id, fhir_id, category, code_system, code, display, value_quantity, value_unit, value_string, effective_time, status, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (participant_account_id, fhir_id) DO UPDATE SET
         category = EXCLUDED.category, code = EXCLUDED.code, display = EXCLUDED.display,
         value_quantity = EXCLUDED.value_quantity, value_unit = EXCLUDED.value_unit,
         value_string = EXCLUDED.value_string, effective_time = EXCLUDED.effective_time,
         status = EXCLUDED.status, raw = EXCLUDED.raw`,
      [
        participantAccountId,
        o.id,
        o.category?.[0]?.coding?.[0]?.code ?? null,
        system ?? null,
        code ?? null,
        display ?? null,
        typeof vq?.value === "number" ? vq.value : null,
        vq?.unit ?? null,
        o.valueString ?? o.valueCodeableConcept?.text ?? null,
        eff ?? null,
        o.status ?? null,
        o,
      ]
    );
  }

  return {
    counts: {
      conditions: conditions.length,
      medications: meds.length,
      observations: observations.length,
    },
    lastDataAt,
  };
}
