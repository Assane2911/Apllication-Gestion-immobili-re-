import { Check, Mail } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import Bulle from "./Bulle";

type Etat = "repos" | "confirmation" | "envoi" | "envoye";

/**
 * Rappel de fin d'essai gratuit, envoyé PAR LA PLATEFORME au gestionnaire (ligne « Essais se terminant bientôt » de
 * l'administration). C'était un lien « mailto: » : sur un poste sans messagerie configurée, le clic n'ouvrait rien et
 * rien ne disait pourquoi.
 *
 * La confirmation est dans la page, pas dans une boîte de dialogue du navigateur : un message part chez un client, on
 * demande donc avant — mais une fenêtre native peut être bloquée par le navigateur, et le geste serait alors muet. Le
 * résultat (envoyé, ou la raison du refus) reste affiché dans la ligne.
 */
export default function BoutonRappelEssai({ managerId, email }: { managerId: string; email: string }) {
  const { t } = useTranslation();
  const [etat, setEtat] = useState<Etat>("repos");
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer() {
    setEtat("envoi");
    setErreur(null);
    try {
      await api.post(`/admin/managers/${managerId}/trial-reminder`);
      setEtat("envoye");
    } catch (err) {
      setErreur(apiErrorMessage(err));
      setEtat("repos");
    }
  }

  if (etat === "envoye") {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
        <Check size={14} aria-hidden="true" />
        {t("admin.dashboard.trialsEndingSoon.sent")}
      </span>
    );
  }

  const enConfirmation = etat === "confirmation" || etat === "envoi";
  return (
    <div className="flex flex-col items-end gap-1.5">
      {enConfirmation ? (
        <div role="group" aria-label={t("admin.dashboard.trialsEndingSoon.confirm", { email })} className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-slate-700">{t("admin.dashboard.trialsEndingSoon.confirm", { email })}</span>
          <button
            type="button"
            onClick={envoyer}
            disabled={etat === "envoi"}
            className="cursor-pointer border border-ink-900 bg-ink-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-orange-700 disabled:cursor-wait disabled:opacity-60"
          >
            {etat === "envoi" ? t("admin.dashboard.trialsEndingSoon.sending") : t("admin.dashboard.trialsEndingSoon.send")}
          </button>
          <button
            type="button"
            onClick={() => setEtat("repos")}
            disabled={etat === "envoi"}
            className="cursor-pointer border border-slate-300 px-2.5 py-1 text-xs font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700 disabled:opacity-60"
          >
            {t("admin.dashboard.trialsEndingSoon.cancel")}
          </button>
        </div>
      ) : (
        <Bulle texte={t("admin.dashboard.trialsEndingSoon.remind", { email })}>
          <button
            type="button"
            onClick={() => {
              setErreur(null);
              setEtat("confirmation");
            }}
            aria-label={t("admin.dashboard.trialsEndingSoon.remind", { email })}
            className="inline-flex size-8 cursor-pointer items-center justify-center border border-slate-300 text-ink-900 hover:border-orange-700 hover:text-orange-700"
          >
            <Mail size={14} aria-hidden="true" />
          </button>
        </Bulle>
      )}
      {erreur && (
        <p role="alert" className="max-w-xs text-right text-xs text-rose-700">
          {erreur}
        </p>
      )}
    </div>
  );
}
