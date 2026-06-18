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
  // Only send a JSON Content-Type when there's actually a body. Sending it on a
  // bodyless GET can trip up some proxies/CDNs into returning a non-JSON response.
  const hasBody = opts.body != null;
  const res = await fetch(`${API_BASE_URL}/api${path}`, {
    ...opts,
    headers: {
      Accept: "application/json",
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });

  if (res.status === 204) return undefined as T;

  // Read the raw text once, then parse — so a non-JSON body yields a useful
  // error (with status + a snippet) instead of an opaque "Unexpected token".
  const text = await res.text();

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = JSON.parse(text);
      if (body?.error) msg = typeof body.error === "string" ? body.error : JSON.stringify(body.error);
    } catch {
      if (text.trim()) msg = `Request failed (${res.status}): ${text.slice(0, 200)}`;
    }
    throw new Error(msg);
  }

  if (!text.trim()) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    const ct = res.headers.get("content-type") ?? "unknown";
    console.warn(`[api] ${path} non-JSON response (content-type=${ct}):`, text.slice(0, 300));
    throw new Error(`Server returned a non-JSON response for ${path} (content-type: ${ct}).`);
  }
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
