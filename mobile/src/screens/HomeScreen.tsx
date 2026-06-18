import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api";
import { useAuth } from "../auth";
import { s, colors } from "../theme";

WebBrowser.maybeCompleteAuthSession();

function Badge({ on }: { on: boolean }) {
  return (
    <View style={[s.badge, on ? s.badgeOn : s.badgeOff]}>
      <Text style={on ? s.badgeTextOn : s.badgeTextOff}>{on ? "Connected" : "Not connected"}</Text>
    </View>
  );
}

function SourceCard({
  title,
  description,
  provider,
  status,
  onConnect,
  onDisconnect,
  busy,
}: {
  title: string;
  description: string;
  provider: "dexcom" | "ehr";
  status: any;
  onConnect: (p: "dexcom" | "ehr") => void;
  onDisconnect: (p: "dexcom" | "ehr") => void;
  busy: boolean;
}) {
  const connected = status?.status === "connected";
  return (
    <View style={s.card}>
      <Text style={s.h2}>{title}</Text>
      <Text style={s.muted}>{description}</Text>
      <Badge on={connected} />
      {status?.last_data_at && (
        <Text style={[s.muted, { fontSize: 12 }]}>
          last data {new Date(status.last_data_at).toLocaleString()}
        </Text>
      )}
      {connected ? (
        <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={() => onDisconnect(provider)} disabled={busy}>
          <Text style={[s.btnText, s.btnSecondaryText]}>Disconnect</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={s.btn} onPress={() => onConnect(provider)} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Connect {title}</Text>}
        </TouchableOpacity>
      )}
    </View>
  );
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <View style={{ minWidth: 90 }}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

export function HomeScreen() {
  const { user, logout } = useAuth();
  const [status, setStatus] = useState<any>(null);
  const [data, setData] = useState<any>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [st, d] = await Promise.all([api.myStatus(), api.myData()]);
    setStatus(st);
    setData(d);
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  // Poll status a few times after a connect (Dexcom backfills its data asynchronously).
  async function reloadWithPolling() {
    for (let i = 0; i < 4; i++) {
      await load().catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  async function onConnect(provider: "dexcom" | "ehr") {
    setBusyProvider(provider);
    setMessage(null);
    try {
      const returnTo = Linking.createURL("oauth");
      const { authorizeUrl } = await api.startConnect(provider, returnTo);
      const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, returnTo);
      if (result.type === "success" && result.url) {
        const { queryParams } = Linking.parse(result.url);
        if (queryParams?.error) {
          setMessage({ kind: "error", text: `Could not connect ${provider.toUpperCase()}. ${queryParams.reason ?? ""}` });
        } else {
          setMessage({ kind: "success", text: `Connected ${provider.toUpperCase()}.` });
        }
      }
      // Whether the deep link round-tripped or the user closed the browser, re-check status.
      await reloadWithPolling();
    } catch (e: any) {
      setMessage({ kind: "error", text: e.message });
    } finally {
      setBusyProvider(null);
    }
  }

  async function onDisconnect(provider: "dexcom" | "ehr") {
    setBusyProvider(provider);
    setMessage(null);
    try {
      await api.disconnect(provider);
      await load();
    } catch (e: any) {
      setMessage({ kind: "error", text: e.message });
    } finally {
      setBusyProvider(null);
    }
  }

  return (
    <View style={s.screen}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.brand }}>
        <View style={s.topbar}>
          <Text style={s.topbarTitle}>
            StudySync <Text style={{ fontWeight: "400", opacity: 0.85 }}>· {user?.participantCode ?? "Participant"}</Text>
          </Text>
          <TouchableOpacity onPress={logout}>
            <Text style={{ color: "#fff", fontSize: 14 }}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={s.h1}>Welcome, {user?.displayName}</Text>

        {message && (
          <Text style={message.kind === "success" ? s.success : s.error}>{message.text}</Text>
        )}

        <SourceCard
          title="Dexcom CGM"
          description="Continuous glucose monitor. Connect your Dexcom sandbox account to share glucose readings."
          provider="dexcom"
          status={status?.dexcom}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          busy={busyProvider === "dexcom"}
        />
        <SourceCard
          title="EHR"
          description="Electronic health record via SMART-on-FHIR. Connect to share your clinical record."
          provider="ehr"
          status={status?.ehr}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          busy={busyProvider === "ehr"}
        />

        <View style={s.card}>
          <Text style={s.h2}>My data</Text>
          {!data ? (
            <ActivityIndicator color={colors.brand} />
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 18 }}>
              <Stat value={(data.glucose.readings ?? 0).toLocaleString()} label="glucose readings" />
              <Stat value={data.glucose.latest ? data.glucose.latest.glucose_mg_dl : "—"} label="latest mg/dL" />
              <Stat value={data.ehr.conditions} label="conditions" />
              <Stat value={data.ehr.medications} label="medications" />
              <Stat value={data.ehr.observations} label="observations" />
            </View>
          )}
        </View>

        <Text style={[s.muted, { textAlign: "center", fontSize: 12 }]}>Pull down to refresh</Text>
      </ScrollView>
    </View>
  );
}
