import React, { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, tokenStore, type User } from "./api";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: { email: string; password: string; displayName: string }) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!(await tokenStore.get())) {
      setUser(null);
      return;
    }
    try {
      const me = await api.me();
      // This app is participant-only. Never let a non-participant session through.
      if (me.role !== "participant") {
        await tokenStore.clear();
        setUser(null);
        return;
      }
      setUser(me);
    } catch {
      await tokenStore.clear();
      setUser(null);
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  // Reject non-participants up front: clear any token and don't set the user, so the app
  // never navigates past the login screen for a researcher account.
  const PARTICIPANT_ONLY = "This app is for participants. Researchers should use the web dashboard.";

  const login = async (email: string, password: string) => {
    const { token, user } = await api.login(email, password);
    if (user.role !== "participant") {
      await tokenStore.clear();
      throw new Error(PARTICIPANT_ONLY);
    }
    await tokenStore.set(token);
    setUser(user);
    return user;
  };

  const register = async (data: { email: string; password: string; displayName: string }) => {
    const { token, user } = await api.register(data);
    if (user.role !== "participant") {
      await tokenStore.clear();
      throw new Error(PARTICIPANT_ONLY);
    }
    await tokenStore.set(token);
    setUser(user);
    return user;
  };

  const logout = async () => {
    await tokenStore.clear();
    setUser(null);
  };

  return (
    <Ctx.Provider value={{ user, loading, login, register, logout, refresh }}>{children}</Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
