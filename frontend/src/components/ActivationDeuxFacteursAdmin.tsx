import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/auth";
import TwoFactorSetupModal from "./TwoFactorSetupModal";
import { AVIS, BOUTON_PLEIN } from "./styleFormulaire";

/**
 * Écran qui remplace l'espace d'administration tant que le compte n'a pas activé la double authentification.
 *
 * Le serveur refuse toute route d'administration à un administrateur sans second facteur (voir exigerDeuxFacteursAdmin,
 * backend/src/middleware/auth.ts) : ce compte confirme les virements, suspend et supprime des agences ; un mot de passe volé ne
 * doit pas suffire. L'administrateur n'est pas enfermé dehors pour autant : il s'enrôle ici avec sa session, puis l'espace
 * s'ouvre sans qu'il ait à se reconnecter (refreshUser relit `twoFactorEnabled`).
 */
export default function ActivationDeuxFacteursAdmin() {
  const { t } = useTranslation();
  const { refreshUser } = useAuth();
  const [ouverte, setOuverte] = useState(false);

  return (
    <section aria-labelledby="activation-2fa-titre" className="max-w-xl space-y-4">
      <div>
        <h2 id="activation-2fa-titre" className="text-2xl font-semibold text-slate-900">
          {t("components.adminLayout.activation.title")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t("components.adminLayout.activation.text")}</p>
      </div>
      <p role="note" className={AVIS}>
        {t("components.adminLayout.activation.why")}
      </p>
      <button type="button" onClick={() => setOuverte(true)} className={`${BOUTON_PLEIN} inline-flex items-center gap-2`}>
        <ShieldCheck size={16} aria-hidden="true" /> {t("components.adminLayout.activation.button")}
      </button>
      {ouverte && (
        <TwoFactorSetupModal
          onSuccess={() => {
            setOuverte(false);
            refreshUser();
          }}
          onClose={() => setOuverte(false)}
        />
      )}
    </section>
  );
}
