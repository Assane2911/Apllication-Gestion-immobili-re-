import { ShieldCheck, ShieldOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import SectionMaintenance from "../../components/SectionMaintenance";
import SectionReglage from "../../components/SectionReglage";
import TwoFactorDisableModal from "../../components/TwoFactorDisableModal";
import TwoFactorSetupModal from "../../components/TwoFactorSetupModal";
import { useAuth } from "../../context/auth";

export default function AdminSettingsPage() {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();
  const [showTwoFactorSetup, setShowTwoFactorSetup] = useState(false);
  const [showTwoFactorDisable, setShowTwoFactorDisable] = useState(false);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t("admin.settings.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("admin.settings.subtitle")}</p>
      </div>

      {/*
        Le compte administrateur est le plus puissant de la plateforme : il suspend ou supprime des agences. Il doit
        pouvoir être protégé par un second facteur, comme n'importe quel compte de gestionnaire.
      */}
      <SectionReglage id="securite" numero="01" titre={t("admin.settings.twoFactor.title")}>
        <p className="max-w-prose text-sm text-slate-600">{t("admin.settings.twoFactor.description")}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {user?.twoFactorEnabled ? (
            <>
              <span className="inline-flex items-center gap-1.5 border border-ink-900 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-ink-900">
                <ShieldCheck size={14} aria-hidden="true" /> {t("admin.settings.twoFactor.enabled")}
              </span>
              <button
                type="button"
                onClick={() => setShowTwoFactorDisable(true)}
                className="cursor-pointer border border-rose-300 px-4 py-2.5 text-xs font-semibold text-rose-800 transition-colors hover:bg-rose-50"
              >
                {t("admin.settings.twoFactor.disableButton")}
              </button>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-900">
                <ShieldOff size={14} aria-hidden="true" /> {t("admin.settings.twoFactor.disabled")}
              </span>
              <button
                type="button"
                onClick={() => setShowTwoFactorSetup(true)}
                className="cursor-pointer bg-ink-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700"
              >
                {t("admin.settings.twoFactor.enableButton")}
              </button>
            </>
          )}
        </div>
      </SectionReglage>

      <SectionMaintenance numero="02" />

      {showTwoFactorSetup && (
        <TwoFactorSetupModal
          onSuccess={() => {
            setShowTwoFactorSetup(false);
            refreshUser();
          }}
          onClose={() => setShowTwoFactorSetup(false)}
        />
      )}
      {showTwoFactorDisable && (
        <TwoFactorDisableModal
          onSuccess={() => {
            setShowTwoFactorDisable(false);
            refreshUser();
          }}
          onClose={() => setShowTwoFactorDisable(false)}
        />
      )}
    </div>
  );
}
