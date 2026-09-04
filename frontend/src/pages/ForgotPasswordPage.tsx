import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import LanguageSwitcher from "../components/LanguageSwitcher";
import Reveal from "../components/Reveal";

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="M3.5 6.5 12 13 20.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // La réponse est volontairement générique côté serveur (existence de
      // l'email jamais révélée) — on affiche donc toujours le même message
      // de succès, que l'adresse soit inscrite ou non.
      await api.post("/auth/forgot-password", { email });
      setSent(true);
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

        {sent ? (
          <div className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center mb-4">
              <MailIcon />
            </div>
            <h2 className="text-xl font-bold text-white">{t("auth.forgotPassword.sentTitle")}</h2>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">{t("auth.forgotPassword.sentSubtitle")}</p>
            <Link
              to="/login"
              className="mt-6 inline-block w-full bg-brand-600 hover:bg-brand-500 text-white rounded-xl py-2.5 text-sm font-semibold shadow-lg shadow-brand-600/30 transition-all hover:scale-[1.02]"
            >
              {t("auth.forgotPassword.backToLoginButton")}
            </Link>
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-white text-center">{t("auth.forgotPassword.title")}</h2>
            <p className="text-sm text-slate-400 text-center mt-1.5">{t("auth.forgotPassword.subtitle")}</p>

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
                {loading ? t("auth.forgotPassword.submitting") : t("auth.forgotPassword.submit")}
              </button>
            </form>
          </>
        )}
      </Reveal>
    </div>
  );
}
