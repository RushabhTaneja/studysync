import React, { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { api } from "../api";
import { useAuth } from "../auth";
import { s } from "../theme";

const CONSENT_TEXT = `By participating in StudySync you consent to share data from the sources you connect (continuous glucose readings from Dexcom and your clinical record via SMART-on-FHIR) with the research team for the purpose of this study. Data is synthetic sandbox data. You may disconnect any source at any time, which stops further data collection.`;

export function ConsentScreen() {
  const { refresh } = useAuth();
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      await api.acceptConsent();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Text style={s.h1}>Consent</Text>
      <View style={s.card}>
        <Text style={s.h2}>Consent notice</Text>
        <Text style={[s.muted, { lineHeight: 21 }]}>{CONSENT_TEXT}</Text>
        <TouchableOpacity style={[s.btn, { marginTop: 8 }]} onPress={accept} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>I consent and want to participate</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
