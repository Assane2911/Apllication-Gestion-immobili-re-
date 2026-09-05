import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { api, apiErrorCode, apiErrorMessage } from "../api/client";
import LanguageSwitcher from "../components/LanguageSwitcher";
import Reveal from "../components/Reveal";
import { useAuth } from "../context/AuthContext";

const DEMO_ACCOUNTS = {
  manager: { email: "gestionnaire@demo.com", password: "Demo1234!" },
  tenant: { email: "amine.silva@demo.com", password: "Demo1234!" },
} as const;

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="M3.5 6.5 12 13 20.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return off ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M6.6 6.7C4.3 8.2 2.7 10.3 2 12c1.6 3.8 5.6 7 10 7 1.6 0 3.1-.4 4.4-1.1M9.9 4.2C10.6 4.1 11.3 4 12 4c4.4 0 8.4 3.2 10 7-.5 1.2-1.2 2.4-2.1 3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12c1.6-3.8 5.6-7 10-7s8.4 3.2 10 7c-1.6 3.8-5.6 7-10 7s-8.4-3.2-10-7Z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
      <path d="M4 12.5 9.5 18 20 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"form" | "manager" | "tenant" | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");

  const highlights = t("auth.login.panel.highlights", { returnObjects: true }) as string[];

  async function doLogin(loginEmail: string, loginPassword: string, source: "form" | "manager" | "tenant") {
    setError(null);
    setUnverifiedEmail(null);
    setResendState("idle");
    setLoading(source);
    try {
      const user = await login(loginEmail, loginPassword);
      navigate(user.role === "MANAGER" ? "/" : "/portail");
    } catch (err) {
      setError(apiErrorMessage(err));
      if (apiErrorCode(err) === "EMAIL_NOT_VERIFIED") {
        setUnverifiedEmail(loginEmail);
      }
    } finally {
      setLoading(null);
    }
  }

  async function handleResendVerification() {
    if (!unverifiedEmail) return;
    setResendState("sending");
    try {
      await api.post("/auth/resend-verification", { email: unverifiedEmail });
      setResendState("sent");
    } catch {
      setResendState("idle");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    doLogin(email, password, "form");
  }

  function tryDemo(role: "manager" | "tenant") {
    const account = DEMO_ACCOUNTS[role];
    setEmail(account.email);
    setPassword(account.password);
    doLogin(account.email, account.password, role);
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-slate-950">
      {/* Panneau de gauche : image de marque (masqué sur mobile) */}
      <div className="hidden lg:flex relative flex-col justify-between overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-brand-950 p-12 xl:p-16">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 -left-16 w-96 h-96 bg-brand-600/20 rounded-full blur-3xl animate-float-slow" />
          <div className="absolute bottom-0 right-0 w-80 h-80 bg-purple-600/20 rounded-full blur-3xl animate-float-delay" />
        </div>

        <Reveal className="relative flex items-center gap-3">
          <img src="/app-icon.png" alt="Logo" className="w-9 h-9 rounded-xl shadow" />
          <span className="font-bold text-lg tracking-tight text-white">{t("common.appName")}</span>
        </Reveal>

        <Reveal delay={100} className="relative max-w-md">
          <h1 className="text-3xl xl:text-4xl font-extrabold text-white leading-tight">
            {t("auth.login.panel.title")}
          </h1>
          <p className="mt-4 text-sm text-slate-400 leading-relaxed">{t("auth.login.panel.subtitle")}</p>

          <ul className="mt-8 space-y-3.5">
            {highlights.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-slate-300">
                <span className="mt-0.5 w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
                  <CheckIcon />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={200} className="relative inline-flex items-center gap-2 text-xs text-brand-300 bg-brand-950/60 border border-brand-500/20 rounded-full px-4 py-2 w-fit">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
          {t("auth.login.panel.trialNote")}
        </Reveal>
      </div>

      {/* Panneau de droite : formulaire */}
      <div className="flex flex-col items-center justify-center px-6 py-12 relative">
        <div className="absolute top-6 left-6 right-6 flex items-center justify-between">
          <Link
            to="/landing"
            className="text-xs font-medium text-slate-500 hover:text-slate-300 transition-colors"
          >
            {t("auth.login.backToHome")}
          </Link>
          <LanguageSwitcher />
        </div>

        <Reveal className="w-full max-w-sm">
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <img src="/app-icon.png" alt="Logo" className="w-9 h-9 rounded-xl shadow" />
            <span className="font-bold text-lg tracking-tight text-white">{t("common.appName")}</span>
          </div>

          <h2 className="text-2xl font-bold text-white text-center">{t("auth.login.title")}</h2>
          <p className="text-sm text-slate-400 text-center mt-1.5">{t("auth.login.subtitle")}</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">{t("auth.login.email")}</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                  <MailIcon />
                </span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 text-slate-100 pl-10 pr-3.5 py-2.5 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                  placeholder={t("auth.login.emailPlaceholder")}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">{t("auth.login.password")}</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                  <LockIcon />
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 text-slate-100 pl-10 pr-10 py-2.5 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                  placeholder={t("auth.login.passwordPlaceholder")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? t("auth.login.hidePassword") : t("auth.login.showPassword")}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <EyeIcon off={showPassword} />
                </button>
              </div>
              <div className="mt-1.5 text-right">
                <Link to="/mot-de-passe-oublie" className="text-xs font-medium text-brand-400 hover:text-brand-300 transition-colors">
                  {t("auth.login.forgotPasswordLink")}
                </Link>
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            {unverifiedEmail && (
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={resendState !== "idle"}
                className="w-full text-xs font-medium text-brand-400 hover:text-brand-300 disabled:opacity-60 transition-colors text-center"
              >
                {resendState === "sending"
                  ? t("auth.login.resendVerificationSending")
                  : resendState === "sent"
                  ? t("auth.login.resendVerificationSent")
                  : t("auth.login.resendVerificationButton")}
              </button>
            )}

            <button
              type="submit"
              disabled={loading !== null}
              className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white rounded-xl py-2.5 text-sm font-semibold shadow-lg shadow-brand-600/30 transition-all hover:scale-[1.02]"
            >
              {loading === "form" && (
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              )}
              {loading === "form" ? t("auth.login.submitting") : t("auth.login.submit")}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-500">
            {t("auth.login.noAccountText")}{" "}
            <Link to="/inscription" className="font-medium text-brand-400 hover:text-brand-300 transition-colors">
              {t("auth.login.registerLink")}
            </Link>
          </p>

          <div className="mt-8">
            <div className="flex items-center gap-3 text-[11px] text-slate-600 uppercase tracking-wider">
              <span className="h-px flex-1 bg-slate-800" />
              {t("auth.login.tryDemoTitle")}
              <span className="h-px flex-1 bg-slate-800" />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => tryDemo("manager")}
                disabled={loading !== null}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/60 hover:bg-slate-800 hover:border-slate-600 disabled:opacity-60 px-3 py-3 text-xs font-medium text-slate-300 transition-all"
              >
                {loading === "manager" ? (
                  <span className="w-4 h-4 border-2 border-slate-500 border-t-brand-400 rounded-full animate-spin" />
                ) : (
                  <span className="text-lg">🏢</span>
                )}
                {t("auth.login.tryDemoManagerLabel")}
              </button>
              <button
                type="button"
                onClick={() => tryDemo("tenant")}
                disabled={loading !== null}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/60 hover:bg-slate-800 hover:border-slate-600 disabled:opacity-60 px-3 py-3 text-xs font-medium text-slate-300 transition-all"
              >
                {loading === "tenant" ? (
                  <span className="w-4 h-4 border-2 border-slate-500 border-t-brand-400 rounded-full animate-spin" />
                ) : (
                  <span className="text-lg">🏠</span>
                )}
                {t("auth.login.tryDemoTenantLabel")}
              </button>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
