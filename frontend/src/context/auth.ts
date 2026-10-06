import { createContext, useContext } from "react";
import type { AuthUser, TwoFactorRequired } from "../types";

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser | TwoFactorRequired>;
  register: (email: string, password: string, referralCode?: string) => Promise<{ pendingVerification: boolean }>;
  loginWithGoogle: (credential: string) => Promise<AuthUser | TwoFactorRequired>;
  /** Deuxième étape d'une connexion qui a renvoyé `twoFactorRequired` — voir login/loginWithGoogle. */
  verifyTwoFactor: (pendingToken: string, code: string) => Promise<AuthUser>;
  verifyEmail: (token: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<AuthUser | null>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans un AuthProvider");
  return ctx;
}
