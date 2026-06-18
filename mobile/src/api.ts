import * as SecureStore from "expo-secure-store";
import { API_BASE_URL } from "./config";

const TOKEN_KEY = "studysync_token";

export const tokenStore = {
  get: () => SecureStore.getItemAsync(TOKEN_KEY),
  set: (t: string) => SecureStore.setItemAsync(TOKEN_KEY, t),
  clear: () => SecureStore.deleteItemAsync(TOKEN_KEY),
};

export interface User {
  id: string;
  email: string;
  role: "participant" | "researcher";
  displayName: string;
  participantCode?: string;
  consentAcceptedAt?: string | null;
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = await tokenStore.get();
  const res = await fetch(`${API_BASE_URL}/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      msg = typeof body.error === "string" ? body.error : JSON.stringify(body.error);
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (data: { email: string; password: string; displayName: string }) =>
    request<{ token: string; user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ ...data, role: "participant" }),
    }),
  me: () => request<User>("/auth/me"),
  acceptConsent: () => request<{ ok: boolean }>("/auth/consent", { method: "POST" }),

  myStatus: () => request<any>("/participant/status"),
  myData: () => request<any>("/participant/data"),
  // returnTo is the app deep link the OAuth callback should redirect back to.
  startConnect: (provider: "dexcom" | "ehr", returnTo: string) =>
    request<{ authorizeUrl: string }>(`/connect/${provider}/start`, {
      method: "POST",
      body: JSON.stringify({ returnTo }),
    }),
  disconnect: (provider: "dexcom" | "ehr") =>
    request<{ ok: boolean }>(`/connect/${provider}/disconnect`, { method: "POST" }),
};
