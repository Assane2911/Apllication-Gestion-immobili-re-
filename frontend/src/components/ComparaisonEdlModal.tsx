import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, isRequestCancelled } from "../api/client";
import type { ComparaisonEdl, RoomCondition, VariationPiece } from "../types";
import { formaterJour } from "../utils/jourCivil";
import CadreModale from "./CadreModale";

const ETAT_CLE: Record<RoomCondition, string> = { BON: "conditionGood", MOYEN: "conditionFair", MAUVAIS: "conditionPoor" };

// Une dégradation est la seule variation qui appelle une décision : elle seule est soulignée en orange foncé.
const TON: Record<VariationPiece, string> = {
  DEGRADE: "border-orange-700 bg-orange-50 text-orange-900",
  SUPPRIMEE: "border-orange-300 bg-orange-50 text-orange-900",
  AJOUTEE: "border-slate-400 bg-white text-slate-800",
  AMELIORE: "border-ink-900 bg-white text-ink-900",
  INCHANGE: "border-slate-300 bg-white text-slate-600",
};

const TITRE_SECTION = "mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-900";

/**
 * Compare l'état des lieux de sortie avec celui d'entrée : pièces (les dégradées d'abord), compteurs, clés.
 * Lecture seule : le serveur met en regard les deux constats finalisés ; la retenue sur le dépôt reste saisie
 * à la main dans le solde de tout compte.
 */
export default function ComparaisonEdlModal({ inspectionId, titre, onClose }: { inspectionId: string; titre: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<ComparaisonEdl | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<ComparaisonEdl>(`/inspections/${inspectionId}/comparison`, { signal: controller.signal })
      .then((res) => setData(res.data))
      .catch((err) => {
        if (isRequestCancelled(err)) return;
        setErreur(apiErrorMessage(err));
      });
    return () => controller.abort();
  }, [inspectionId]);

  const etat = (c: RoomCondition) => t(`manager.inspections.${ETAT_CLE[c]}`);
  const remarque = (notes: string) => notes.trim() || t("manager.inspections.compare.noNote");

  return (
    <CadreModale
      titre={t("manager.inspections.compare.title")}
      titreId="comparaison-edl-titre"
      sousTitre={titre}
      largeur="xl"
      onClose={onClose}
    >
      <div className="space-y-6">
        {erreur && <p role="alert" className="text-sm text-red-600">{erreur}</p>}
        {!data && !erreur && <p className="text-sm text-slate-600">{t("manager.inspections.compare.loading")}</p>}

        {data && (
          <>
            <p className="font-mono text-[11px] uppercase tracking-wider text-slate-600">
              {t("manager.inspections.compare.dates", {
                entry: formaterJour(data.entry.inspectionDate, i18n.language),
                exit: formaterJour(data.exit.inspectionDate, i18n.language),
              })}
            </p>

            <dl className="grid grid-cols-2 gap-px border border-slate-300 bg-slate-300 sm:grid-cols-3">
              {(
                [
                  ["degraded", data.summary.degraded, data.summary.degraded > 0],
                  ["missingKeys", data.summary.missingKeys, data.summary.missingKeys > 0],
                  ["improved", data.summary.improved, false],
                  ["unchanged", data.summary.unchanged, false],
                  ["added", data.summary.added, false],
                  ["removed", data.summary.removed, false],
                ] as const
              ).map(([cle, valeur, alerte]) => (
                <div key={cle} className="bg-white px-3 py-2.5">
                  <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t(`manager.inspections.compare.summary.${cle}`)}</dt>
                  <dd className={`mt-0.5 text-xl font-semibold tabular-nums ${alerte ? "text-orange-800" : "text-slate-900"}`}>{valeur}</dd>
                </div>
              ))}
            </dl>

            <section>
              <h4 className={TITRE_SECTION}>{t("manager.inspections.compare.rooms")}</h4>
              {data.rooms.length === 0 ? (
                <p className="text-xs text-slate-600">{t("manager.inspections.compare.noRooms")}</p>
              ) : (
                <ul className="space-y-2">
                  {data.rooms.map((p, i) => (
                    <li key={`${p.name}-${i}`} className={`border border-l-4 p-3 ${TON[p.variation]}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-slate-900">{p.name}</p>
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider">{t(`manager.inspections.compare.variation.${p.variation}`)}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                        {(["entry", "exit"] as const).map((cote) => {
                          const c = p[cote];
                          return (
                            <div key={cote} className="min-w-0">
                              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t(`manager.inspections.compare.${cote}`)}</p>
                              {c ? (
                                <p className="mt-0.5 text-slate-800">
                                  <span className="font-semibold">{etat(c.condition)}</span> — <span className="break-words">{remarque(c.notes)}</span>
                                </p>
                              ) : (
                                <p className="mt-0.5 text-slate-500">—</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className={TITRE_SECTION}>{t("manager.inspections.compare.meters")}</h4>
              {data.meters.length === 0 ? (
                <p className="text-xs text-slate-600">{t("manager.inspections.compare.noMeters")}</p>
              ) : (
                <ul className="divide-y divide-slate-200 border border-slate-300">
                  {data.meters.map((m) => (
                    <li key={m.type} className="grid grid-cols-1 gap-1 p-3 text-xs sm:grid-cols-4 sm:items-center">
                      <span className="font-semibold text-slate-900">{t(`manager.inspections.meter${m.type === "electricity" ? "Electricity" : m.type === "water" ? "Water" : "Gas"}`)}</span>
                      <span className="tabular-nums text-slate-700">{t("manager.inspections.compare.entry")} : {m.entry || "—"}</span>
                      <span className="tabular-nums text-slate-700">{t("manager.inspections.compare.exit")} : {m.exit || "—"}</span>
                      <span className="tabular-nums text-slate-900">
                        {t("manager.inspections.compare.consumption")} :{" "}
                        <span className="font-semibold">{m.consumption === null ? t("manager.inspections.compare.notComputable") : m.consumption.toLocaleString(i18n.language)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className={TITRE_SECTION}>{t("manager.inspections.compare.keys")}</h4>
              {data.keys.length === 0 ? (
                <p className="text-xs text-slate-600">{t("manager.inspections.compare.noKeys")}</p>
              ) : (
                <ul className="divide-y divide-slate-200 border border-slate-300">
                  {data.keys.map((k) => (
                    <li key={k.label} className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
                      <span className="font-semibold text-slate-900">{k.label}</span>
                      <span className="tabular-nums text-slate-700">
                        {k.entry} → {k.exit}
                      </span>
                      <span className={`font-mono text-[10px] font-semibold uppercase tracking-wider ${k.missing > 0 ? "text-orange-800" : "text-slate-600"}`}>
                        {k.missing > 0 ? t("manager.inspections.compare.missing", { count: k.missing }) : t("manager.inspections.compare.complete")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <p className="border-t border-slate-200 pt-4 text-xs text-slate-600">{t("manager.inspections.compare.disclaimer")}</p>
          </>
        )}
      </div>
    </CadreModale>
  );
}
