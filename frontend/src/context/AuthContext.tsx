import { Capacitor } from "@capacitor/core";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { AuthUser, TwoFactorRequired } from "../types";
import { AuthContext } from "./auth";

// Indice non sensible (jamais le jeton lui-même) qu'une connexion web a déjà
// eu lieu sur cet appareil, pour éviter d'appeler /auth/me à chaque montage
// pour un simple visiteur — voir refreshUser ci-dessous. Volontairement
// distinct de la clé "user" : de nombreux tests posent directement "user" en
// localStorage pour simuler un profil déjà chargé sans passer par login(),
// et ne doivent pas de ce seul fait déclencher un appel réseau.
const SESSION_HINT_KEY = "hasSession";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem("user");
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  });
  const [loading, setLoading] = useState(false);

  async function refreshUser(): Promise<AuthUser | null> {
    // Natif (app Capacitor) : le jeton reste dans localStorage et porté par
    // l'en-tête Authorization (voir api/client.ts) — inutile d'appeler /me
    // sans lui. Web : l'authentification voyage dans un cookie httpOnly
    // illisible depuis ce code, donc impossible à tester directement ; voir
    // SESSION_HINT_KEY ci-dessus. Un indice présent mais un cookie expiré ou
    // absent se résout simplement par le 401 de l'appel.
    const indiceSessionLocale = Capacitor.isNativePlatform()
      ? localStorage.getItem("token")
      : localStorage.getItem(SESSION_HINT_KEY);
    if (!indiceSessionLocale) return null;
    try {
      const { data } = await api.get("/auth/me");
      const updatedUser: AuthUser = {
        id: data.id,
        email: data.email,
        role: data.role,
        hasPassword: data.hasPassword,
        // Champ facultatif dans AuthUser, donc son oubli ne se voyait pas à la
        // compilation : la devise disparaissait de l'objet ET du stockage
        // local réécrit juste en dessous, rendant morte la synchronisation
        // profil -> affichage de CurrencyContext. Plus rien ne pouvait alors
        // rétablir le choix depuis le serveur.
        currency: data.currency,
        tenantId: data.tenant?.id ?? null,
        tenantName: data.tenant ? `${data.tenant.firstName} ${data.tenant.lastName}` : null,
        ownerId: data.owner?.id ?? null,
        ownerName: data.owner ? `${data.owner.firstName} ${data.owner.lastName}` : null,
        subscription: data.subscription,
        twoFactorEnabled: data.twoFactorEnabled,
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

  /**
   * Installe la session une fois l'identité ENTIÈREMENT prouvée (mot de
   * passe seul, ou mot de passe + second facteur) — partagée par login(),
   * loginWithGoogle(), verifyTwoFactor() et verifyEmail(), qui reçoivent
   * toutes la même forme `{token, user}` en réponse.
   */
  function installSession(data: { token: string; user: AuthUser }): AuthUser {
    // Web : le serveur vient de poser le cookie httpOnly qui portera
    // l'authentification (voir api/client.ts) — stocker aussi le jeton en
    // clair ici recréerait exactement le risque de vol par XSS que cette
    // migration retire. Natif : pas de cookie fiable, le jeton reste géré
    // comme avant.
    if (Capacitor.isNativePlatform()) {
      localStorage.setItem("token", data.token);
    }
    localStorage.setItem("user", JSON.stringify(data.user));
    localStorage.setItem(SESSION_HINT_KEY, "1");
    setUser(data.user);
    return data.user;
  }

  /**
   * Quand le compte exige un second facteur (voir twoFactor.controller.ts
   * côté serveur), le serveur ne pose ENCORE aucun cookie et ne renvoie
   * qu'un jeton intermédiaire de courte durée (`pendingToken`) : aucune
   * session n'est installée tant que verifyTwoFactor() ne l'a pas échangé
   * contre une vraie, une fois le code vérifié.
   */
  async function login(email: string, password: string): Promise<AuthUser | TwoFactorRequired> {
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      if (data.twoFactorRequired) return data as TwoFactorRequired;
      return installSession(data);
    } finally {
      setLoading(false);
    }
  }

  async function verifyTwoFactor(pendingToken: string, code: string): Promise<AuthUser> {
    setLoading(true);
    try {
      const { data } = await api.post("/auth/2fa/verify-login", { pendingToken, code });
      return installSession(data);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Connexion / inscription automatique via Google (gestionnaires
   * uniquement) — `credential` est le jeton d'identité renvoyé par Google
   * Identity Services (voir GoogleSignInButton.tsx), vérifié côté serveur
   * dans loginWithGoogle (auth.controller.ts). Contrairement à register(),
   * la réponse contient directement un token exploitable : Google a déjà
   * vérifié l'adresse, il n'y a pas d'étape de confirmation par email.
   */
  async function loginWithGoogle(credential: string): Promise<AuthUser | TwoFactorRequired> {
    setLoading(true);
    try {
      const { data } = await api.post("/auth/google", { credential });
      if (data.twoFactorRequired) return data as TwoFactorRequired;
      return installSession(data);
    } finally {
      setLoading(false);
    }
  }

  async function register(email: string, password: string) {
    setLoading(true);
    try {
      const { data } = await api.post("/auth/register", { email, password });
      // `email` ne fait plus partie de la réponse : le renvoyer permettait de
      // distinguer une adresse libre d'une adresse déjà prise, et donc de
      // tester qui a un compte (voir registerManager côté serveur).
      return data as { pendingVerification: boolean };
    } finally {
      setLoading(false);
    }
  }

  async function verifyEmail(token: string): Promise<AuthUser> {
    setLoading(true);
    try {
      const { data } = await api.post("/auth/verify-email", { token });
      return installSession(data);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    if (Capacitor.isNativePlatform()) {
      localStorage.removeItem("token");
    }
    localStorage.removeItem("user");
    localStorage.removeItem(SESSION_HINT_KEY);
    setUser(null);
    try {
      // Efface le cookie httpOnly côté serveur : la seule chose qu'un
      // frontend web ne peut plus faire lui-même pour un jeton qu'il ne lit
      // ni ne stocke plus (voir api/client.ts). Un échec ici (cookie déjà
      // absent ou expiré, réseau coupé) ne remet pas en cause la
      // déconnexion locale déjà actée ci-dessus.
      await api.post("/auth/logout");
    } catch {
      // Rien de plus à faire : voir le commentaire ci-dessus.
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, loginWithGoogle, verifyTwoFactor, verifyEmail, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}
