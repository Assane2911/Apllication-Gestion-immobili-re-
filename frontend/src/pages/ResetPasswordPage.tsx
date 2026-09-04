import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import LanguageSwitcher from "../components/LanguageSwitcher";
import Reveal from "../components/Reveal";

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

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("auth.resetPassword.mismatchError"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.resetPassword.tooShortError"));
      return;
    }

    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, password });
      setDone(true);
      setTimeout(() => navigate("/login"), 2500);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-6 py-12 relative">
      <div className="absolute top-6 left-6 right-6 flex items-center justify-between">
        <Link to="/login" className="text-xs font-medium text-slate-500 hover:text-slate-300 transition-colors">
          {t("auth.forgotPassword.backToLogin")}
        </Link>
        <LanguageSwitcher />
      </div>

      <Reveal className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <img src="/app-icon.png" alt="Logo" className="w-9 h-9 rounded-xl shadow" />
          <span className="font-bold text-lg tracking-tight text-white">{t("common.appName")}</span>
        </div>

        {!token ? (
          <div className="text-center">
            <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-3">
              {t("auth.resetPassword.missingToken")}
            </p>
            <Link
              to="/mot-de-passe-oublie"
              className="mt-6 inline-block w-full bg-brand-600 hover:bg-brand-500 text-white rounded-xl py-2.5 text-sm font-semibold shadow-lg shadow-brand-600/30 transition-all hover:scale-[1.02]"
            >
              {t("auth.resetPassword.requestNewLink")}
            </Link>
          </div>
        ) : done ? (
          <div className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center mb-4">
              <LockIcon />
            </div>
            <h2 className="text-xl font-bold text-white">{t("auth.resetPassword.doneTitle")}</h2>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">{t("auth.resetPassword.doneSubtitle")}</p>
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-white text-center">{t("auth.resetPassword.title")}</h2>
            <p className="text-sm text-slate-400 text-center mt-1.5">{t("auth.resetPassword.subtitle")}</p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  {t("auth.resetPassword.newPassword")}
                </label>
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
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  {t("auth.resetPassword.confirmPassword")}
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                    <LockIcon />
                  </span>
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 text-slate-100 pl-10 pr-3.5 py-2.5 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                    placeholder={t("auth.login.passwordPlaceholder")}
                  />
                </div>
              </div>

              {error && (
                <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white rounded-xl py-2.5 text-sm font-semibold shadow-lg shadow-brand-600/30 transition-all hover:scale-[1.02]"
              >
                {loading && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                {loading ? t("auth.resetPassword.submitting") : t("auth.resetPassword.submit")}
              </button>
            </form>
          </>
        )}
      </Reveal>
    </div>
  );
}
