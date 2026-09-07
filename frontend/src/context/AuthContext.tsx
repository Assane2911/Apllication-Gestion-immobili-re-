import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { AuthUser } from "../types";
import { AuthContext } from "./auth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem("user");
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  });
  const [loading, setLoading] = useState(false);

  async function refreshUser(): Promise<AuthUser | null> {
    const token = localStorage.getItem("token");
    if (!token) return null;
    try {
      const { data } = await api.get("/auth/me");
      const updatedUser: AuthUser = {
        id: data.id,
        email: data.email,
        role: data.role,
        tenantId: data.tenant?.id ?? null,
        tenantName: data.tenant ? `${data.tenant.firstName} ${data.tenant.lastName}` : null,
        subscription: data.subscription,
      };
      localStorage.setItem("user", JSON.stringify(updatedUser));
      setUser(updatedUser);
      return updatedUser;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    refreshUser();
  }, []);

  async function login(email: string, password: string) {
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setUser(data.user);
      return data.user as AuthUser;
    } finally {
      setLoading(false);
    }
  }

  async function register(email: string, password: string) {
    setLoading(true);
    try {
      const { data } = await api.post("/auth/register", { email, password });
      return data as { pendingVerification: boolean; email: string };
    } finally {
      setLoading(false);
    }
  }

  async function verifyEmail(token: string) {
    setLoading(true);
    try {
      const { data } = await api.post("/auth/verify-email", { token });
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setUser(data.user);
      return data.user as AuthUser;
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, verifyEmail, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}
