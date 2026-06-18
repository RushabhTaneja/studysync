import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { useAuth } from "../auth";
import { s, colors } from "../theme";

export function LoginScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      // The auth layer rejects non-participant accounts (researchers use the web dashboard)
      // and throws before any session is established, so the message surfaces below.
      if (mode === "login") await login(email.trim(), password);
      else await register({ email: email.trim(), password, displayName });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 20, paddingTop: 64, gap: 16 }}>
      <View style={{ alignItems: "center", marginBottom: 8 }}>
        <Text style={{ fontSize: 30, fontWeight: "800", color: colors.brand }}>StudySync</Text>
        <Text style={s.muted}>Wearable Data Platform · Participant</Text>
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["login", "register"] as const).map((m) => (
          <TouchableOpacity
            key={m}
            onPress={() => setMode(m)}
            style={[s.btn, s.btnSecondary, mode === m && { backgroundColor: colors.brand, borderColor: colors.brand }, { flex: 1 }]}
          >
            <Text style={[s.btnSecondaryText, mode === m && { color: "#fff" }]}>
              {m === "login" ? "Sign in" : "Register"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.card}>
        {error && <Text style={s.error}>{error}</Text>}
        {mode === "register" && (
          <View>
            <Text style={s.label}>Name</Text>
            <TextInput style={s.input} value={displayName} onChangeText={setDisplayName} autoCapitalize="words" />
          </View>
        )}
        <View>
          <Text style={s.label}>Email</Text>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
          />
        </View>
        <View>
          <Text style={s.label}>Password</Text>
          <TextInput style={s.input} value={password} onChangeText={setPassword} secureTextEntry />
        </View>
        <TouchableOpacity style={s.btn} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>{mode === "login" ? "Sign in" : "Create account"}</Text>}
        </TouchableOpacity>
      </View>

      <View style={[s.card, { gap: 2 }]}>
        <Text style={{ fontWeight: "600", color: colors.ink }}>Seeded participant</Text>
        <Text style={s.muted}>participant@studysync.dev / participant123</Text>
      </View>
    </ScrollView>
  );
}
