import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiErrorMessage } from "../api/client";
import AuthLayout from "../components/AuthLayout";
import Seo from "../components/Seo";
import { useAuth } from "../context/auth";

const BOUTON_PRINCIPAL =
  "flex w-full cursor-pointer items-center justify-center gap-2 bg-ink-900 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60";

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
    <AuthLayout page="verifyEmail" retour={t("auth.verifyEmail.backToLogin")} retourVers="/login">
      <Seo title={`${t("seo.verifyEmail.title")} | ${t("common.appName")}`} noindex />

      {!token ? (
        <div>
          <h1 className="sr-only">{t("auth.verifyEmail.errorTitle")}</h1>
          <p className="border border-red-300 bg-red-50 px-3 py-3 text-sm text-red-800">{t("auth.verifyEmail.missingToken")}</p>
          <Link to="/login" className={`mt-6 ${BOUTON_PRINCIPAL}`}>
            {t("auth.verifyEmail.backToLogin")}
          </Link>
        </div>
      ) : status === "verifying" ? (
        <div>
          <div className="flex size-12 items-center justify-center border border-slate-300 bg-slate-50">
            <span className="size-5 animate-spin rounded-full border-2 border-ink-900/30 border-t-ink-900" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">{t("auth.verifyEmail.verifying")}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{t("auth.verifyEmail.verifyingSubtitle")}</p>
        </div>
      ) : status === "success" ? (
        <div role="status">
          <div className="flex size-12 items-center justify-center border border-slate-300 bg-slate-50 text-ink-900">
            <CheckCircle2 size={24} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">{t("auth.verifyEmail.successTitle")}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{t("auth.verifyEmail.successSubtitle")}</p>
          <div aria-hidden="true" className="mt-5 h-1.5 bg-slate-200">
            <div className="h-full bg-ink-900 motion-safe:animate-[remplir_2.5s_linear_forwards]" />
          </div>
        </div>
      ) : (
        <div>
          <div className="flex size-12 items-center justify-center border border-red-300 bg-red-50 text-red-700">
            <XCircle size={24} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">{t("auth.verifyEmail.errorTitle")}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{error ?? t("auth.verifyEmail.errorSubtitle")}</p>
          <Link to="/login" className={`mt-6 ${BOUTON_PRINCIPAL}`}>
            {t("auth.verifyEmail.backToLogin")}
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}
