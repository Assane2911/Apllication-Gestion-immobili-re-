import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiErrorMessage } from "../api/client";
import LanguageSwitcher from "../components/LanguageSwitcher";
import Reveal from "../components/Reveal";
import { useAuth } from "../context/AuthContext";

function CheckCircleIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5 11 15.5 16 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function VerifyEmailPage() {
  const { t } = useTranslation();
  const { verifyEmail } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        await verifyEmail(token);
        if (cancelled) return;
        setStatus("success");
        setTimeout(() => navigate("/"), 2500);
      } catch (err) {
        if (cancelled) return;
        setError(apiErrorMessage(err));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-6 py-12 relative">
      <div className="absolute top-6 left-6 right-6 flex items-center justify-between">
        <Link to="/login" className="text-xs font-medium text-slate-500 hover:text-slate-300 transition-colors">
          {t("auth.verifyEmail.backToLogin")}
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
              {t("auth.verifyEmail.missingToken")}
            </p>
            <Link
              to="/login"
              className="mt-6 inline-block w-full bg-brand-600 hover:bg-brand-500 text-white rounded-xl py-2.5 text-sm font-semibold shadow-lg shadow-brand-600/30 transition-all hover:scale-[1.02]"
            >
              {t("auth.verifyEmail.backToLogin")}
            </Link>
          </div>
        ) : status === "verifying" ? (
          <div className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-brand-500/15 text-brand-400 flex items-center justify-center mb-4">
              <span className="w-5 h-5 border-2 border-brand-400/40 border-t-brand-400 rounded-full animate-spin" />
            </div>
            <h2 className="text-xl font-bold text-white">{t("auth.verifyEmail.verifying")}</h2>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">{t("auth.verifyEmail.verifyingSubtitle")}</p>
          </div>
        ) : status === "success" ? (
          <div className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center mb-4">
              <CheckCircleIcon />
            </div>
            <h2 className="text-xl font-bold text-white">{t("auth.verifyEmail.successTitle")}</h2>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">{t("auth.verifyEmail.successSubtitle")}</p>
          </div>
        ) : (
          <div className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-red-500/15 text-red-400 flex items-center justify-center mb-4">
              <span className="text-2xl">✕</span>
            </div>
            <h2 className="text-xl font-bold text-white">{t("auth.verifyEmail.errorTitle")}</h2>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">{error ?? t("auth.verifyEmail.errorSubtitle")}</p>
            <Link
              to="/login"
              className="mt-6 inline-block w-full bg-brand-600 hover:bg-brand-500 text-white rounded-xl py-2.5 text-sm font-semibold shadow-lg shadow-brand-600/30 transition-all hover:scale-[1.02]"
            >
              {t("auth.verifyEmail.backToLogin")}
            </Link>
          </div>
        )}
      </Reveal>
    </div>
  );
}
