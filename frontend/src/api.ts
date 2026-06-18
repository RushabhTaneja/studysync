// Thin API client. Auth token is kept in localStorage and sent as a bearer header.

const TOKEN_KEY = "studysync_token";

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
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
  const token = tokenStore.get();
  const res = await fetch(`/api${path}`, {
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
  return res.json() as Promise<T>;
}

export const api = {
  // auth
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (data: { email: string; password: string; displayName: string; role: string }) =>
    request<{ token: string; user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  me: () => request<User>("/auth/me"),
  acceptConsent: () => request<{ ok: boolean }>("/auth/consent", { method: "POST" }),

  // participant
  myStatus: () => request<any>("/participant/status"),
  myData: () => request<any>("/participant/data"),
  startConnect: (provider: "dexcom" | "ehr") =>
    request<{ authorizeUrl: string }>(`/connect/${provider}/start`, { method: "POST" }),
  disconnect: (provider: "dexcom" | "ehr") =>
    request<{ ok: boolean }>(`/connect/${provider}/disconnect`, { method: "POST" }),

  // researcher
  cohort: () => request<{ cohort: any[] }>("/researcher/cohort"),
  alerts: () => request<{ alerts: any[]; thresholdPct: number }>("/researcher/alerts"),
  participant: (code: string, days = 30) =>
    request<any>(`/researcher/participant/${code}?days=${days}`),
  adherence: (code: string, days = 30) =>
    request<any>(`/researcher/participant/${code}/adherence?days=${days}`),
  agp: (code: string, days = 30) =>
    request<any>(`/researcher/participant/${code}/agp?days=${days}`),
  exportUrl: (code: string) => `/api/researcher/participant/${code}/export`,
};
