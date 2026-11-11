import { CalendarSync, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, isRequestCancelled } from "../api/client";
import type { LienCalendrier, LienCalendrierCree } from "../types";
import { formaterJour } from "../utils/jourCivil";
import { AVIS, BOUTON_ANNULER, BOUTON_DANGER, BOUTON_PLEIN, BOUTON_TRAIT, CHAMP, ERREUR, ETIQUETTE, INFO } from "./styleFormulaire";

type Confirmation = "regenerer" | "desactiver" | null;

/** Adresse absolue du flux : la base de l'API peut être relative (« /api ») quand le site et l'API partagent le même domaine. */
export function adresseDuFlux(path: string): string {
  const base = String(api.defaults.baseURL ?? "");
  return new URL(`${base}${path}`, window.location.origin).toString();
}

/** « webcal://… » : ouvre directement l'application Calendrier (iPhone, Mac, Outlook) pour s'abonner. */
export function adresseWebcal(adresse: string): string {
  return adresse.replace(/^https?:/, "webcal:");
}

/**
 * Abonnement de l'agenda à un calendrier externe (Google Agenda, Outlook, iPhone) par un lien secret. Le lien n'est montré
 * qu'à sa création : le serveur n'en garde que l'empreinte. Le régénérer coupe l'ancien ; le désactiver supprime l'accès.
 */
export default function AbonnementCalendrier() {
  const { t, i18n } = useTranslation();
  const [ouvert, setOuvert] = useState(false);
  const [etat, setEtat] = useState<LienCalendrier | null>(null);
  const [lien, setLien] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [copie, setCopie] = useState(false);

  // L'état n'est lu qu'à l'ouverture du panneau : la page Agenda n'a pas à le payer à chaque visite.
  useEffect(() => {
    if (!ouvert || etat) return;
    const controller = new AbortController();
    api
      .get<LienCalendrier>("/agenda/feed", { signal: controller.signal })
      .then((res) => setEtat(res.data))
      .catch((err) => {
        if (isRequestCancelled(err)) return;
        setErreur(apiErrorMessage(err));
      });
    return () => controller.abort();
  }, [ouvert, etat]);

  async function creer() {
    setOccupe(true);
    setErreur(null);
    try {
      const res = await api.post<LienCalendrierCree>("/agenda/feed");
      setLien(adresseDuFlux(res.data.path));
      setEtat({ active: true, createdAt: res.data.createdAt, lastUsedAt: null });
      setConfirmation(null);
      setCopie(false);
    } catch (err) {
      setErreur(apiErrorMessage(err));
    } finally {
      setOccupe(false);
    }
  }

  async function desactiver() {
    setOccupe(true);
    setErreur(null);
    try {
      await api.delete("/agenda/feed");
      setEtat({ active: false, createdAt: null, lastUsedAt: null });
      setLien(null);
      setConfirmation(null);
    } catch (err) {
      setErreur(apiErrorMessage(err));
    } finally {
      setOccupe(false);
    }
  }

  async function copier() {
    if (!lien) return;
    try {
      await navigator.clipboard.writeText(lien);
      setCopie(true);
      setTimeout(() => setCopie(false), 1500);
    } catch {
      // Pas de presse-papiers (permission refusée, contexte non sécurisé) : le lien reste affiché, sélectionnable à la main.
    }
  }

  const jour = (iso: string) => formaterJour(iso, i18n.language);

  return (
    <section aria-labelledby="agenda-sync-titre" className="border border-slate-300 bg-white">
      <h3 id="agenda-sync-titre" className="m-0">
        <button
          type="button"
          onClick={() => setOuvert((o) => !o)}
          aria-expanded={ouvert}
          aria-controls="agenda-sync-corps"
          className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-3 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50"
        >
          <CalendarSync size={16} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-ink-900" />
          {t("manager.agenda.sync.title")}
        </button>
      </h3>

      {ouvert && (
        <div id="agenda-sync-corps" className="space-y-4 border-t border-slate-200 px-4 py-4">
          <p className="text-xs text-slate-700">{t("manager.agenda.sync.intro")}</p>

          {erreur && (
            <p role="alert" className={ERREUR}>
              {erreur}
            </p>
          )}
          {!etat && !erreur && <p className="text-xs text-slate-600">{t("manager.agenda.sync.loading")}</p>}

          {etat && !etat.active && (
            <button type="button" onClick={creer} disabled={occupe} className={BOUTON_PLEIN}>
              {occupe ? t("manager.agenda.sync.creating") : t("manager.agenda.sync.create")}
            </button>
          )}

          {etat?.active && (
            <>
              {lien ? (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="agenda-sync-lien" className={ETIQUETTE}>
                      {t("manager.agenda.sync.linkLabel")}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <input id="agenda-sync-lien" readOnly value={lien} onFocus={(e) => e.currentTarget.select()} className={`${CHAMP} min-w-0 basis-full font-mono text-xs sm:basis-0 sm:flex-1`} />
                      <button type="button" onClick={copier} className={`${BOUTON_TRAIT} inline-flex items-center gap-1.5`}>
                        <Copy size={13} aria-hidden="true" />
                        {copie ? t("common.actions.copied") : t("common.actions.copy")}
                      </button>
                      <a href={adresseWebcal(lien)} className={`${BOUTON_PLEIN} inline-flex items-center`}>
                        {t("manager.agenda.sync.openInCalendar")}
                      </a>
                    </div>
                  </div>
                  <p className={INFO}>{t("manager.agenda.sync.shownOnce")}</p>
                </div>
              ) : (
                <div className="space-y-1 text-xs text-slate-700">
                  {etat.createdAt && <p>{t("manager.agenda.sync.activeSince", { date: jour(etat.createdAt) })}</p>}
                  <p>{etat.lastUsedAt ? t("manager.agenda.sync.lastRead", { date: jour(etat.lastUsedAt) }) : t("manager.agenda.sync.neverRead")}</p>
                </div>
              )}

              <p className={AVIS}>{t("manager.agenda.sync.privacy")}</p>

              <div>
                <p className={ETIQUETTE}>{t("manager.agenda.sync.howTitle")}</p>
                <ul className="list-disc space-y-1 pl-5 text-xs text-slate-700">
                  <li>{t("manager.agenda.sync.howGoogle")}</li>
                  <li>{t("manager.agenda.sync.howOutlook")}</li>
                  <li>{t("manager.agenda.sync.howPhone")}</li>
                </ul>
              </div>

              {confirmation ? (
                <div className="space-y-3 border border-slate-300 bg-slate-50 p-3">
                  <p role="alert" className="text-xs text-slate-800">
                    {t(confirmation === "regenerer" ? "manager.agenda.sync.regenerateWarn" : "manager.agenda.sync.disableWarn")}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={confirmation === "regenerer" ? creer : desactiver} disabled={occupe} className={confirmation === "regenerer" ? BOUTON_PLEIN : BOUTON_DANGER}>
                      {t("manager.agenda.sync.confirm")}
                    </button>
                    <button type="button" onClick={() => setConfirmation(null)} disabled={occupe} className={BOUTON_ANNULER}>
                      {t("manager.agenda.sync.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setConfirmation("regenerer")} className={BOUTON_TRAIT}>
                    {t("manager.agenda.sync.regenerate")}
                  </button>
                  <button type="button" onClick={() => setConfirmation("desactiver")} className={BOUTON_TRAIT}>
                    {t("manager.agenda.sync.disable")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
