import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import SectionReglage from "./SectionReglage";
import { AIDE, AVIS, BOUTON_PLEIN, BOUTON_TRAIT, CHAMP, ERREUR, ETIQUETTE } from "./styleFormulaire";

/**
 * Droits d'une personne qui n'a PAS de compte : un garant d'un bail, un prospect qui a écrit depuis une annonce.
 *
 * Elle adresse sa demande d'accès (RGPD art. 15, portabilité art. 20) ou d'effacement (art. 17) à l'agence, responsable de
 * traitement ; le locataire et le propriétaire ont déjà leur bouton sur leur fiche, pas elle. La personne se retrouve par son
 * adresse e-mail ou son téléphone, parmi ce que CETTE agence détient (voir backend/src/controllers/personne.controller.ts).
 */
export default function SectionDroitsPersonnes({ numero }: { numero: string }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const critere = { ...(email.trim() ? { email: email.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}) };
  const renseigne = Object.keys(critere).length > 0;

  async function exporter(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setInfo(null);
    setEnCours(true);
    try {
      const res = await api.get("/personnes/export", { params: critere, responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = "donnees-personne.json";
      lien.click();
      URL.revokeObjectURL(url);
      setInfo(t("manager.agencySettings.personRights.exported"));
    } catch (err) {
      // Une réponse en pièce jointe (blob) : le message d'erreur du serveur arrive lui aussi en blob, lu par apiErrorMessage.
      setErreur(await apiErrorMessageBlob(err));
    } finally {
      setEnCours(false);
    }
  }

  async function anonymiser() {
    if (!confirm(t("manager.agencySettings.personRights.confirmAnonymize"))) return;
    setErreur(null);
    setInfo(null);
    setEnCours(true);
    try {
      const res = await api.post<{ garants: number; prospects: number }>("/personnes/anonymiser", critere);
      setInfo(t("manager.agencySettings.personRights.anonymized", { guarantors: res.data.garants, prospects: res.data.prospects }));
    } catch (err) {
      setErreur(apiErrorMessage(err));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <SectionReglage id="agency-droits" numero={numero} titre={t("manager.agencySettings.personRights.title")}>
      <p className="text-sm text-slate-600">{t("manager.agencySettings.personRights.description")}</p>
      <form onSubmit={exporter} className="mt-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="droits-email" className={ETIQUETTE}>
              {t("manager.agencySettings.personRights.email")}
            </label>
            <input id="droits-email" type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className={CHAMP} />
          </div>
          <div>
            <label htmlFor="droits-phone" className={ETIQUETTE}>
              {t("manager.agencySettings.personRights.phone")}
            </label>
            <input id="droits-phone" type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} className={CHAMP} />
          </div>
        </div>
        <p className={AIDE}>{t("manager.agencySettings.personRights.hint")}</p>
        {erreur && (
          <p role="alert" className={ERREUR}>
            {erreur}
          </p>
        )}
        {info && (
          <p role="status" className={AVIS}>
            {info}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={!renseigne || enCours} className={`${BOUTON_PLEIN} disabled:cursor-not-allowed`}>
            {t("manager.agencySettings.personRights.exportButton")}
          </button>
          <button type="button" disabled={!renseigne || enCours} onClick={anonymiser} className={BOUTON_TRAIT}>
            {t("manager.agencySettings.personRights.anonymizeButton")}
          </button>
        </div>
      </form>
    </SectionReglage>
  );
}

/** Quand la réponse était demandée en blob, le corps JSON de l'erreur est un Blob : on le relit avant d'en tirer le message. */
async function apiErrorMessageBlob(err: unknown): Promise<string> {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try {
      const corps = JSON.parse(await data.text());
      return apiErrorMessage({ ...(err as object), response: { ...(err as { response: object }).response, data: corps } });
    } catch {
      // corps illisible : message générique ci-dessous
    }
  }
  return apiErrorMessage(err);
}
