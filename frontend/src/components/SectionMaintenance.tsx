import { CheckCircle2, Wrench } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import { debutAVenir, type EtatMaintenance, enCours, lireEtat, problemeDeFenetre, versChampLocal } from "../utils/maintenance";
import SectionReglage from "./SectionReglage";

/** En deçà, une maintenance qui démarre « presque tout de suite » mérite une confirmation : personne n'aura le temps d'enregistrer. */
const PREAVIS_MIN_MS = 15 * 60 * 1000;

/**
 * Programmation de la maintenance planifiée (voir backend/src/services/maintenance.service.ts) : une fenêtre de début et de fin,
 * un message facultatif. Avant le début, un bandeau l'annonce aux utilisateurs ; pendant, ils voient l'écran de maintenance et
 * seul l'administrateur garde l'accès. « Terminer maintenant » clôt une maintenance en cours ; la fenêtre a de toute façon une fin.
 */
export default function SectionMaintenance({ numero }: { numero: string }) {
  const { t, i18n } = useTranslation();
  const [etat, setEtat] = useState<EtatMaintenance | null>(null);
  const [chargeOk, setChargeOk] = useState(false);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [form, setForm] = useState({ debut: "", fin: "", message: "" });
  const [prevenir, setPrevenir] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function appliquer(brut: unknown) {
    const lu = lireEtat((brut as { maintenance?: unknown } | undefined)?.maintenance);
    setEtat(lu);
    if (lu) setForm({ debut: versChampLocal(lu.debut), fin: versChampLocal(lu.fin), message: lu.message ?? "" });
  }

  useEffect(() => {
    api
      .get("/admin/maintenance")
      .then((res) => {
        appliquer(res.data);
        setChargeOk(true);
      })
      .catch((err) => setErreurChargement(apiErrorMessage(err)));
  }, []);

  const probleme = problemeDeFenetre(form.debut, form.fin);
  // L'annonce par e-mail n'a de sens que pour une maintenance qui n'a pas encore commencé.
  const annonceDisponible = debutAVenir(form.debut);
  const enCoursMaintenant = enCours(etat);
  const quand = (iso: string) => new Date(iso).toLocaleString(i18n.language, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  async function programmer(e: FormEvent) {
    e.preventDefault();
    if (probleme) return;
    if (new Date(form.debut).getTime() - Date.now() < PREAVIS_MIN_MS && !window.confirm(t("admin.settings.maintenance.confirmSoon"))) return;
    setEnvoi(true);
    setErreur(null);
    setInfo(null);
    try {
      const notifier = prevenir && annonceDisponible;
      const res = await api.put("/admin/maintenance", {
        debut: new Date(form.debut).toISOString(),
        fin: new Date(form.fin).toISOString(),
        message: form.message.trim(),
        ...(notifier && { notifier: true }),
      });
      appliquer(res.data);
      const annonce = (res.data as { annonce?: { destinataires: number; envoyes: number; echecs: number } | null }).annonce;
      setPrevenir(false);
      setInfo(
        [
          t("admin.settings.maintenance.scheduled"),
          annonce && t("admin.settings.maintenance.notify.sent", { envoyes: annonce.envoyes, destinataires: annonce.destinataires }),
          annonce && annonce.echecs > 0 && t("admin.settings.maintenance.notify.failed", { echecs: annonce.echecs }),
        ]
          .filter(Boolean)
          .join(" ")
      );
    } catch (err) {
      setErreur(apiErrorMessage(err));
    } finally {
      setEnvoi(false);
    }
  }

  async function annuler() {
    setEnvoi(true);
    setErreur(null);
    setInfo(null);
    try {
      await api.delete("/admin/maintenance");
      setEtat(null);
      setForm({ debut: "", fin: "", message: "" });
      setInfo(enCoursMaintenant ? t("admin.settings.maintenance.ended") : t("admin.settings.maintenance.cancelled"));
    } catch (err) {
      setErreur(apiErrorMessage(err));
    } finally {
      setEnvoi(false);
    }
  }

  const champ = "w-full border border-slate-400 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-ink-900 focus:outline-none focus:ring-2 focus:ring-ink-900/20";
  const etiquette = "mb-1 block font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-700";

  return (
    <SectionReglage id="maintenance" numero={numero} titre={t("admin.settings.maintenance.title")}>
      <p className="max-w-prose text-sm text-slate-600">{t("admin.settings.maintenance.description")}</p>

      {erreurChargement ? (
        <div role="alert" className="mt-4 border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {erreurChargement}
        </div>
      ) : (
        chargeOk && (
          <>
            <p
              className={`mt-4 inline-flex items-center gap-2 border px-3 py-1.5 text-xs font-semibold ${
                enCoursMaintenant ? "border-orange-300 bg-orange-50 text-orange-900" : etat ? "border-ink-900 bg-slate-50 text-ink-900" : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              <Wrench size={14} aria-hidden="true" />
              {enCoursMaintenant
                ? t("admin.settings.maintenance.status.active", { fin: quand(etat!.fin) })
                : etat
                  ? t("admin.settings.maintenance.status.planned", { debut: quand(etat.debut), fin: quand(etat.fin) })
                  : t("admin.settings.maintenance.status.none")}
            </p>

            {info && (
              <div role="status" className="mt-4 flex items-center gap-2 border border-ink-900 bg-slate-50 px-4 py-3 text-sm text-ink-900">
                <CheckCircle2 size={15} aria-hidden="true" /> {info}
              </div>
            )}
            {erreur && (
              <div role="alert" className="mt-4 border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {erreur}
              </div>
            )}

            <form onSubmit={programmer} className="mt-5 space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="maintenance-debut" className={etiquette}>
                    {t("admin.settings.maintenance.fields.start")}
                  </label>
                  <input id="maintenance-debut" type="datetime-local" value={form.debut} onChange={(e) => setForm({ ...form, debut: e.target.value })} className={champ} />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, debut: versChampLocal(new Date()) })}
                    className="mt-1.5 cursor-pointer border-b border-ink-900/40 text-xs font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700"
                  >
                    {t("admin.settings.maintenance.startNow")}
                  </button>
                </div>
                <div>
                  <label htmlFor="maintenance-fin" className={etiquette}>
                    {t("admin.settings.maintenance.fields.end")}
                  </label>
                  <input id="maintenance-fin" type="datetime-local" value={form.fin} onChange={(e) => setForm({ ...form, fin: e.target.value })} className={champ} />
                </div>
              </div>

              <div>
                <label htmlFor="maintenance-message" className={etiquette}>
                  {t("admin.settings.maintenance.fields.message")}
                </label>
                <textarea
                  id="maintenance-message"
                  rows={3}
                  maxLength={500}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  placeholder={t("admin.settings.maintenance.fields.messagePlaceholder")}
                  className={champ}
                />
                <p className="mt-1 text-right font-mono text-[11px] text-slate-500">{form.message.length} / 500</p>
              </div>

              <div>
                <label className={`flex items-start gap-2.5 text-sm ${annonceDisponible ? "cursor-pointer text-slate-800" : "cursor-not-allowed text-slate-500"}`}>
                  <input
                    type="checkbox"
                    checked={prevenir && annonceDisponible}
                    disabled={!annonceDisponible}
                    onChange={(e) => setPrevenir(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-ink-900"
                  />
                  <span>
                    <span className="font-semibold">{t("admin.settings.maintenance.notify.label")}</span>
                    <span className="mt-0.5 block text-xs text-slate-600">
                      {annonceDisponible ? t("admin.settings.maintenance.notify.hint") : t("admin.settings.maintenance.notify.late")}
                    </span>
                  </span>
                </label>
              </div>

              {probleme && probleme !== "incomplete" && (
                <p role="alert" className="font-mono text-[11px] text-orange-700">
                  {t(`admin.settings.maintenance.invalid.${probleme}`)}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
                <button
                  type="submit"
                  disabled={envoi || probleme !== null}
                  className="cursor-pointer bg-ink-900 px-6 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {envoi ? t("admin.settings.maintenance.saving") : etat ? t("admin.settings.maintenance.update") : t("admin.settings.maintenance.schedule")}
                </button>
                {etat && (
                  <button
                    type="button"
                    onClick={annuler}
                    disabled={envoi}
                    className="cursor-pointer border border-rose-300 px-4 py-2.5 text-xs font-semibold text-rose-800 transition-colors hover:bg-rose-50 disabled:opacity-60"
                  >
                    {enCoursMaintenant ? t("admin.settings.maintenance.endNow") : t("admin.settings.maintenance.cancel")}
                  </button>
                )}
              </div>
            </form>
          </>
        )
      )}
    </SectionReglage>
  );
}
