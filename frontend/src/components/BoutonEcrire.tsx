import { Mail } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import Bulle from "./Bulle";
import CadreModale from "./CadreModale";
import { BOUTON_ANNULER, BOUTON_PLEIN, CHAMP, ERREUR, ETIQUETTE, INFO } from "./styleFormulaire";

interface Props {
  /** Le compte à qui l'on écrit (gestionnaire, collaborateur, auteur d'une suggestion). */
  userId: string;
  /** Son adresse : affichée dans la fenêtre, jamais utilisée pour ouvrir une messagerie. */
  email: string;
  /** « icone » : une enveloppe discrète avec infobulle (à côté d'une adresse) ; « lien » : une action nommée. */
  variante?: "icone" | "lien";
  /** Texte de l'action en variante « lien ». */
  libelle?: string;
  /** Classes de la variante « lien », pour garder la mise en page de la page qui l'accueille. */
  className?: string;
}

const MIN_OBJET = 3;
const MIN_MESSAGE = 5;

/**
 * « Écrire à… » de l'administration : le message part DE LA PLATEFORME (POST /admin/users/:id/message), les réponses arrivant
 * sur l'adresse de l'administrateur. C'étaient des liens « mailto: » : sur un poste sans messagerie configurée, le clic n'ouvrait
 * rien et rien ne disait pourquoi. La fenêtre est dans la page (pas une boîte du navigateur, qui peut être bloquée) et montée
 * hors de l'élément qui porte le bouton : ce bouton se trouve parfois dans un paragraphe, où une fenêtre ne peut pas s'imbriquer.
 * Le résultat — envoyé, ou la raison du refus — reste affiché dans la fenêtre.
 */
export default function BoutonEcrire({ userId, email, variante = "icone", libelle, className }: Props) {
  const { t } = useTranslation();
  const [ouvert, setOuvert] = useState(false);
  const [objet, setObjet] = useState("");
  const [message, setMessage] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [envoye, setEnvoye] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  function ouvrir() {
    setObjet("");
    setMessage("");
    setErreur(null);
    setEnvoye(false);
    setOuvert(true);
  }

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    if (objet.trim().length < MIN_OBJET || message.trim().length < MIN_MESSAGE) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await api.post(`/admin/users/${userId}/message`, { subject: objet.trim(), message: message.trim() });
      setEnvoye(true);
    } catch (err) {
      setErreur(apiErrorMessage(err));
    } finally {
      setEnvoi(false);
    }
  }

  const nom = t("admin.managers.writeTo", { email });
  const declencheur =
    variante === "icone" ? (
      <Bulle texte={nom}>
        <button
          type="button"
          onClick={ouvrir}
          aria-label={nom}
          className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center text-slate-500 hover:text-orange-700"
        >
          <Mail size={12} aria-hidden="true" />
        </button>
      </Bulle>
    ) : (
      <button
        type="button"
        onClick={ouvrir}
        className={
          className ?? "inline-flex cursor-pointer items-center gap-1.5 border-b border-ink-900/40 pb-0.5 text-xs font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700"
        }
      >
        <Mail size={13} aria-hidden="true" />
        {libelle ?? nom}
      </button>
    );

  const fermer = () => setOuvert(false);
  const pret = objet.trim().length >= MIN_OBJET && message.trim().length >= MIN_MESSAGE;

  return (
    <>
      {declencheur}
      {ouvert &&
        createPortal(
          <CadreModale
            titre={t("admin.message.title", { email })}
            titreId={`ecrire-${userId}`}
            sousTitre={t("admin.message.subtitle")}
            onClose={fermer}
            fermable={!envoi}
            largeur="lg"
          >
            {envoye ? (
              <div className="space-y-4">
                <p role="status" className={INFO}>
                  {t("admin.message.sent", { email })}
                </p>
                <div className="flex justify-end border-t border-slate-300 pt-4">
                  <button type="button" onClick={fermer} className={BOUTON_PLEIN}>
                    {t("common.actions.close")}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={envoyer} className="space-y-4">
                <div>
                  <label htmlFor={`ecrire-objet-${userId}`} className={ETIQUETTE}>
                    {t("admin.message.subjectLabel")}
                  </label>
                  <input
                    id={`ecrire-objet-${userId}`}
                    type="text"
                    required
                    maxLength={150}
                    value={objet}
                    onChange={(e) => setObjet(e.target.value)}
                    className={CHAMP}
                  />
                </div>
                <div>
                  <label htmlFor={`ecrire-message-${userId}`} className={ETIQUETTE}>
                    {t("admin.message.messageLabel")}
                  </label>
                  <textarea
                    id={`ecrire-message-${userId}`}
                    required
                    rows={7}
                    maxLength={5000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className={CHAMP}
                  />
                </div>
                {erreur && (
                  <p role="alert" className={ERREUR}>
                    {erreur}
                  </p>
                )}
                <div className="flex justify-end gap-3 border-t border-slate-300 pt-4">
                  <button type="button" onClick={fermer} disabled={envoi} className={BOUTON_ANNULER}>
                    {t("common.actions.cancel")}
                  </button>
                  <button type="submit" disabled={envoi || !pret} className={BOUTON_PLEIN}>
                    {envoi ? t("admin.message.sending") : t("admin.message.send")}
                  </button>
                </div>
              </form>
            )}
          </CadreModale>,
          document.body
        )}
    </>
  );
}
