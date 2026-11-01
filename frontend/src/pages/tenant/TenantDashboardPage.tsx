import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardList,
  Download,
  FileCheck,
  Home,
  MapPin,
  PenLine,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, fileUrl, liste } from "../../api/client";
import Badge from "../../components/Badge";
import SectionReglage from "../../components/SectionReglage";
import DocumentModal from "../../components/DocumentModal";
import ScannedContractModal from "../../components/ScannedContractModal";
import SignatureModal from "../../components/SignatureModal";
import { useCurrency } from "../../context/currency";
import type { Contract, Inspection } from "../../types";
import Bulle from "../../components/Bulle";
import PlanLogement from "../../components/PlanLogement";
import { ecartEnJours, formaterJour } from "../../utils/jourCivil";

const BOUTON_PLEIN =
  "cursor-pointer bg-ink-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-orange-700";
const BOUTON_CONTOUR =
  "inline-flex cursor-pointer items-center gap-1.5 border border-slate-400 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900";
const ETIQUETTE = "font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600";

/** Avancement d'un bail en pourcentage, de son premier à son dernier jour (0 avant le début, 100 après la fin). */
function avancementBail(debut: string, fin: string): number {
  const total = ecartEnJours(fin) - ecartEnJours(debut);
  if (total <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((-ecartEnJours(debut) / total) * 100)));
}

export default function TenantDashboardPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [signingContract, setSigningContract] = useState<Contract | null>(null);
  const [viewingLeaseContract, setViewingLeaseContract] = useState<Contract | null>(null);
  const [viewingScannedContract, setViewingScannedContract] = useState<{ title: string; url: string } | null>(null);
  const [signingInspection, setSigningInspection] = useState<Inspection | null>(null);
  const [viewingReportInspection, setViewingReportInspection] = useState<Inspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportingData, setExportingData] = useState(false);

  async function handleExportMyData() {
    setExportingData(true);
    try {
      const res = await api.get("/tenants/mine/export", { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "mes-donnees.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setExportingData(false);
    }
  }

  function load() {
    Promise.all([api.get<Contract[]>("/contracts/mine"), api.get<Inspection[]>("/inspections/mine")])
      .then(([contractsRes, inspectionsRes]) => {
        setContracts(liste<Contract>(contractsRes.data));
        setInspections(liste<Inspection>(inspectionsRes.data));
        setError(null);
      })
      .catch((err) => setError(apiErrorMessage(err)));
  }

  useEffect(() => {
    load();
  }, []);

  if (error) {
    return (
      <div className="border border-rose-200 bg-rose-50 p-6 text-rose-700">
        <p className="text-sm">{error}</p>
        <button
          onClick={load}
          className="mt-4 cursor-pointer bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-700"
        >
          {t("common.actions.retry")}
        </button>
      </div>
    );
  }

  /*
    Droit d'accès (RGPD art. 15) et portabilité (art. 20) exercés directement
    par le locataire : la politique de confidentialité les annonçait comme
    traités manuellement, ce qui supposait qu'il sache à qui écrire et qu'on
    lui réponde. La section dit aussi, explicitement, ce que ce bouton ne fait
    PAS — rectifier et effacer relèvent du gestionnaire, responsable de
    traitement.

    Elle est rendue dans les DEUX états de la page : un locataire dont aucun
    bail n'a encore été rattaché a le même droit d'accès que les autres, et
    c'est justement l'état où il n'a personne à qui parler dans le Service.
  */
  const sectionDonneesPersonnelles = (
    <SectionReglage id="donnees" numero={String(contracts.length + 2).padStart(2, "0")} titre={t("tenant.dashboard.privacy.title")}>
      <p className="max-w-prose text-sm text-slate-600">{t("tenant.dashboard.privacy.description")}</p>
      <Bulle texte={t("tenant.tips.exportData")}>
        <button type="button" onClick={handleExportMyData} disabled={exportingData} className={`mt-4 ${BOUTON_CONTOUR} disabled:opacity-60`}>
          {exportingData ? t("tenant.dashboard.privacy.downloading") : t("tenant.dashboard.privacy.download")}
        </button>
      </Bulle>
    </SectionReglage>
  );

  if (contracts.length === 0) {
    return (
      <div className="space-y-6">
        <div className="border border-slate-300 bg-white p-8 text-center shadow-[inset_4px_0_0_var(--color-ink-900)]">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center border border-slate-300 bg-slate-50 text-ink-900">
            <Home size={22} strokeWidth={1.75} aria-hidden="true" />
          </div>
          <h3 className="text-base font-bold text-slate-900">{t("tenant.dashboard.noContract")}</h3>
          <p className="mt-1 text-xs text-slate-600">{t("tenant.dashboard.noLeaseHint")}</p>
        </div>
        {sectionDonneesPersonnelles}
      </div>
    );
  }

  // Ce qui attend le locataire, tous baux confondus : chaque ligne mène à l'endroit où le faire.
  const aFaire: Array<{ cle: string; texte: string; lien: { href: string; interne: boolean } }> = [];
  for (const c of contracts) {
    const titre = c.property?.title ?? "";
    if (!c.signedByTenantAt && c.qualite !== "COLOCATAIRE") {
      aFaire.push({ cle: `bail-${c.id}`, texte: t("tenant.dashboard.todo.lease", { property: titre }), lien: { href: `#bail-${c.id}`, interne: false } });
    }
    for (const insp of inspections) {
      if (insp.contractId === c.id && insp.status === "COMPLETED" && !insp.signedByTenantAt && c.qualite !== "COLOCATAIRE") {
        aFaire.push({ cle: `edl-${insp.id}`, texte: t("tenant.dashboard.todo.inspection", { property: titre }), lien: { href: `#bail-${c.id}`, interne: false } });
      }
    }
    const impayes = (c.invoices ?? []).filter((i) => i.status !== "PAID" && i.status !== "CANCELLED").length;
    if (impayes > 0) {
      aFaire.push({ cle: `loyer-${c.id}`, texte: t("tenant.dashboard.todo.rent", { count: impayes }), lien: { href: "/portail/paiements", interne: true } });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 inline-flex items-center gap-1.5 border border-slate-300 bg-white px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-900">
          <ShieldCheck size={13} aria-hidden="true" />
          {t("tenant.dashboard.verified")}
        </p>
        <h2 className="text-2xl font-semibold text-slate-900">{t("tenant.dashboard.title")}</h2>
        <p className="mt-1 max-w-xl text-sm text-slate-600">{t("tenant.dashboard.intro")}</p>
      </div>

      <SectionReglage id="a-faire" numero="01" titre={t("tenant.dashboard.todo.title")}>
        {aFaire.length === 0 ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <CheckCircle2 size={16} aria-hidden="true" />
            {t("tenant.dashboard.todo.allClear")}
          </p>
        ) : (
          <ul className="grid gap-px border border-slate-300 bg-slate-300 sm:grid-cols-2 sm:[&>li:last-child:nth-child(odd)]:col-span-2">
            {aFaire.map((ligne) => {
              const contenu = (
                <>
                  <AlertTriangle size={15} aria-hidden="true" className="shrink-0 text-orange-700" />
                  <span className="min-w-0 flex-1">{ligne.texte}</span>
                  <ArrowRight size={14} aria-hidden="true" className="shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-orange-700" />
                </>
              );
              const classes =
                "group flex items-center gap-3 bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-[inset_4px_0_0_var(--color-orange-700)] transition-colors hover:bg-slate-50";
              return (
                <li key={ligne.cle} className="bg-white">
                  {ligne.lien.interne ? (
                    <Link to={ligne.lien.href} className={classes}>{contenu}</Link>
                  ) : (
                    <a href={ligne.lien.href} className={classes}>{contenu}</a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionReglage>

      {contracts.map((c, index) => {
        const unpaid = (c.invoices ?? []).filter((i) => i.status !== "PAID" && i.status !== "CANCELLED");
        const prochaine = [...unpaid].sort((x, y) => new Date(x.dueDate).getTime() - new Date(y.dueDate).getTime())[0];
        const factures = (c.invoices ?? []).filter((i) => i.status !== "CANCELLED");
        const reglees = factures.filter((i) => i.status === "PAID").length;
        const joursAvantDebut = ecartEnJours(c.startDate);
        const joursRestants = ecartEnJours(c.endDate);
        const pct = avancementBail(c.startDate, c.endDate);
        const ecartEcheance = prochaine ? ecartEnJours(prochaine.dueDate) : null;
        const adresseCarte = c.property?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.property.address)}` : null;
        return (
          <article key={c.id} id={`bail-${c.id}`} className="scroll-mt-6 border border-slate-300 bg-white">
            <header className="flex items-baseline gap-3 border-b border-slate-300 bg-slate-50 px-5 py-3">
              <span aria-hidden="true" className="font-mono text-[11px] font-semibold text-orange-700">{String(index + 2).padStart(2, "0")}</span>
              <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-900">{t("tenant.dashboard.mainHousing")}</h3>
            </header>

            <div className="sm:grid sm:grid-cols-[18rem_1fr]">
              {/* Le logement : sa photo, ou à défaut son plan. */}
              <div className="relative h-48 overflow-hidden border-b border-slate-300 bg-slate-100 sm:h-auto sm:min-h-56 sm:border-b-0 sm:border-r">
                {c.property?.imageUrl ? (
                  <img src={fileUrl(c.property.imageUrl) ?? undefined} alt={c.property.title} className="h-full w-full object-cover" />
                ) : (
                  <PlanLogement id={c.property?.id ?? c.id} className="h-full w-full pb-10" />
                )}
                <div className="absolute right-3 top-3 z-10">
                  <Badge status={c.status} />
                </div>
              </div>

              <div className="min-w-0 p-5 sm:p-6">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  <Building2 size={13} aria-hidden="true" />
                  <span>{c.property?.address}</span>
                </div>
                <h4 className="mt-1 text-xl font-bold tracking-tight text-slate-900">{c.property?.title}</h4>
                {adresseCarte && (
                  <a
                    href={adresseCarte}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 border-b border-ink-900/40 pb-0.5 text-xs font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700"
                  >
                    <MapPin size={13} aria-hidden="true" />
                    {t("tenant.dashboard.openMap")}
                  </a>
                )}

                {/* Les chiffres du bail, en cases accolées. */}
                <dl className="mt-5 grid grid-cols-2 gap-px border border-slate-300 bg-slate-300 sm:grid-cols-4">
                  <div className="bg-white p-3.5">
                    <dt className={ETIQUETTE}>{t("tenant.dashboard.monthlyRent")}</dt>
                    <dd className="mt-1.5 text-base font-bold tabular-nums text-slate-900 sm:text-lg">{formatMoney(c.rent, c.currency)}</dd>
                  </div>
                  <div className="bg-white p-3.5">
                    <dt className={ETIQUETTE}>{t("tenant.dashboard.deposit")}</dt>
                    <dd className="mt-1.5 text-base font-bold tabular-nums text-slate-900 sm:text-lg">{formatMoney(c.deposit, c.currency)}</dd>
                  </div>
                  <div className="bg-white p-3.5">
                    <dt className={ETIQUETTE}>{t("tenant.dashboard.startDate")}</dt>
                    <dd className="mt-1.5 text-sm font-semibold text-slate-800">{formaterJour(c.startDate, i18n.language)}</dd>
                  </div>
                  <div className="bg-white p-3.5">
                    <dt className={ETIQUETTE}>{t("tenant.dashboard.endDate")}</dt>
                    <dd className="mt-1.5 text-sm font-semibold text-slate-800">{formaterJour(c.endDate, i18n.language)}</dd>
                  </div>
                </dl>
                {c.paymentDay ? (
                  <p className="mt-2 font-mono text-[11px] text-slate-600">
                    {c.paymentDay >= 31 ? t("tenant.dashboard.dueDayLast") : t("tenant.dashboard.dueDay", { day: c.paymentDay })}
                  </p>
                ) : null}

                {/* Où en est le bail, du premier au dernier jour. */}
                <div className="mt-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className={ETIQUETTE}>{t("tenant.dashboard.progress.title")}</p>
                    <p className="font-mono text-[11px] font-semibold text-ink-900">
                      {joursAvantDebut > 0
                        ? t("tenant.dashboard.progress.startsIn", { count: joursAvantDebut })
                        : joursRestants < 0
                          ? t("tenant.dashboard.progress.ended")
                          : t("tenant.dashboard.progress.daysLeft", { count: joursRestants })}
                    </p>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={t("tenant.dashboard.progress.title")}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                    className="mt-2 h-2 bg-slate-200"
                  >
                    <div className={`h-full ${joursRestants >= 0 && joursRestants <= 60 ? "bg-orange-700" : "bg-ink-900"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-slate-600">{t("tenant.dashboard.progress.elapsed", { pct })}</p>
                </div>

                {/* La prochaine échéance de loyer, et l'historique des règlements. */}
                <div className="mt-5 flex flex-wrap items-stretch gap-px border border-slate-300 bg-slate-300">
                  <div className="min-w-48 flex-1 bg-slate-50 p-3.5">
                    <p className={ETIQUETTE}>{t("tenant.dashboard.nextRent.title")}</p>
                    {prochaine && ecartEcheance !== null ? (
                      <>
                        <p className="mt-1.5 text-sm font-bold tabular-nums text-slate-900">
                          {`${formaterJour(prochaine.dueDate, i18n.language, { day: "numeric", month: "long", year: "numeric" })} · ${formatMoney(prochaine.resteDu ?? prochaine.amount, prochaine.currency ?? c.currency)}`}
                        </p>
                        <p className={`mt-0.5 font-mono text-[11px] font-semibold ${ecartEcheance < 0 ? "text-orange-700" : "text-slate-700"}`}>
                          {ecartEcheance < 0
                            ? t("tenant.dashboard.nextRent.late", { count: -ecartEcheance })
                            : ecartEcheance === 0
                              ? t("tenant.dashboard.nextRent.today")
                              : t("tenant.dashboard.nextRent.dueIn", { count: ecartEcheance })}
                        </p>
                      </>
                    ) : (
                      <p className="mt-1.5 text-sm font-semibold text-ink-900">{t("tenant.dashboard.nextRent.upToDate")}</p>
                    )}
                  </div>
                  {factures.length > 0 && (
                    <div className="min-w-48 flex-1 bg-slate-50 p-3.5">
                      <p className={ETIQUETTE}>{t("tenant.dashboard.nextRent.history")}</p>
                      <p className="mt-1.5 text-sm font-bold text-slate-900">{t("tenant.dashboard.nextRent.paid", { paid: reglees, total: factures.length })}</p>
                      <div aria-hidden="true" className="mt-2 h-1.5 bg-slate-200">
                        <div className="h-full bg-ink-900" style={{ width: `${(reglees / factures.length) * 100}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-5 border-t border-slate-300 p-5 sm:p-6">
              {/* État de la signature du bail */}
              <div className="flex flex-wrap items-center justify-between gap-3.5 border border-slate-300 bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                  <div className={`flex size-9 items-center justify-center border ${c.signedByTenantAt ? "border-ink-900 bg-white text-ink-900" : "border-orange-300 bg-orange-50 text-orange-700"}`}>
                    {c.signedByTenantAt ? <CheckCircle2 size={18} aria-hidden="true" /> : <PenLine size={16} aria-hidden="true" />}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900">{t("tenant.dashboard.signatureTitle")}</p>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {c.signedByTenantAt ? (
                        <span className="font-semibold text-ink-900">
                          {t(c.qualite === "COLOCATAIRE" ? "tenant.dashboard.signedByHolderOn" : "tenant.dashboard.signedOn", {
                            date: new Date(c.signedByTenantAt).toLocaleDateString(i18n.language),
                          })}
                        </span>
                      ) : c.qualite === "COLOCATAIRE" ? null : (
                        <span className="font-semibold text-orange-700">{t("tenant.dashboard.awaitingSignature")}</span>
                      )}
                    </p>
                    {c.qualite === "COLOCATAIRE" && <p className="mt-1 text-[11px] text-slate-600">{t("tenant.dashboard.cotenantNote")}</p>}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!c.signedByTenantAt && c.qualite !== "COLOCATAIRE" && (
                    <Bulle texte={t("tenant.tips.signContract")}>
                      <button onClick={() => setSigningContract(c)} className={BOUTON_PLEIN}>
                        <PenLine size={13} className="-mt-0.5 inline shrink-0" aria-hidden="true" /> {t("tenant.dashboard.signMyLease")}
                      </button>
                    </Bulle>
                  )}
                  <Bulle texte={t("tenant.tips.viewLease")}>
                    <button onClick={() => setViewingLeaseContract(c)} className={BOUTON_CONTOUR}>
                      <Download size={13} aria-hidden="true" /> {t("tenant.dashboard.viewLeasePdf")}
                    </button>
                  </Bulle>

                  {c.scannedContractUrl && (
                    <button
                      onClick={async () => {
                        if (c.scannedContractUrl && /^https?:\/\//i.test(c.scannedContractUrl)) {
                          setViewingScannedContract({
                            title: t("tenant.dashboard.leaseDocTitle", { property: c.property?.title }),
                            url: c.scannedContractUrl,
                          });
                          return;
                        }
                        try {
                          const res = await api.get<{ url: string }>(`/documents/lease-scan/${c.id}`);
                          setViewingScannedContract({
                            title: t("tenant.dashboard.leaseDocTitle", { property: c.property?.title }),
                            url: res.data.url,
                          });
                        } catch (err) {
                          alert(apiErrorMessage(err));
                        }
                      }}
                      className={BOUTON_CONTOUR}
                    >
                      <FileCheck size={14} aria-hidden="true" />
                      <span>{t("tenant.dashboard.viewScannedLease")}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Restitution du dépôt de garantie, une fois enregistrée par le gestionnaire */}
              {c.depositRefundedAt && (
                <div className="space-y-2 border border-slate-300 bg-slate-50 p-4 shadow-[inset_4px_0_0_var(--color-ink-900)]">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={16} className="text-ink-900" aria-hidden="true" />
                    <p className="text-xs font-bold text-slate-900">
                      {t("tenant.dashboard.depositRefundTitle", {
                        amount: formatMoney(
                          c.deposit - (c.depositDeductions ?? []).reduce((somme, d) => somme + d.amount, 0),
                          c.currency
                        ),
                      })}
                    </p>
                  </div>
                  {(c.depositDeductions ?? []).length > 0 && (
                    <ul className="list-disc space-y-0.5 pl-6 text-xs text-slate-700">
                      {(c.depositDeductions ?? []).map((d, i) => (
                        <li key={i}>
                          {d.label} — {formatMoney(d.amount, c.currency)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* États des lieux (entrée/sortie) rattachés à ce contrat */}
              {inspections.filter((insp) => insp.contractId === c.id).length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-slate-900">{t("tenant.dashboard.inspectionsTitle")}</p>
                  {inspections
                    .filter((insp) => insp.contractId === c.id)
                    .map((insp) => (
                      <div key={insp.id} className="flex flex-wrap items-center justify-between gap-3 border border-slate-300 bg-slate-50 p-3.5">
                        <div>
                          <p className="text-xs font-semibold text-slate-800">
                            {insp.type === "ENTRY" ? t("tenant.dashboard.inspectionEntry") : t("tenant.dashboard.inspectionExit")}
                          </p>
                          <p className="mt-0.5 text-xs">
                            {insp.status === "DRAFT" ? (
                              <span className="text-slate-600">{t("tenant.dashboard.inspectionAwaitingCompletion")}</span>
                            ) : c.qualite === "COLOCATAIRE" ? null : insp.signedByTenantAt ? (
                              <span className="font-semibold text-ink-900">
                                {t("tenant.dashboard.inspectionSignedByYouOn", { date: new Date(insp.signedByTenantAt).toLocaleDateString(i18n.language) })}
                              </span>
                            ) : (
                              <span className="font-semibold text-orange-700">{t("tenant.dashboard.inspectionAwaitingYourSignature")}</span>
                            )}
                          </p>
                        </div>
                        {insp.status === "COMPLETED" && (
                          <div className="flex flex-wrap items-center gap-2">
                            {!insp.signedByTenantAt && c.qualite !== "COLOCATAIRE" && (
                              <Bulle texte={t("tenant.tips.signInspection")}>
                                <button onClick={() => setSigningInspection(insp)} className={BOUTON_PLEIN}>
                                  <PenLine size={13} className="-mt-0.5 inline shrink-0" aria-hidden="true" /> {t("tenant.dashboard.inspectionSignMine")}
                                </button>
                              </Bulle>
                            )}
                            <Bulle texte={t("tenant.tips.viewInspection")}>
                              <button onClick={() => setViewingReportInspection(insp)} className={BOUTON_CONTOUR}>
                                <ClipboardList size={13} aria-hidden="true" /> {t("tenant.dashboard.inspectionViewReport")}
                              </button>
                            </Bulle>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              )}

              {/* Loyers en attente */}
              {unpaid.length > 0 && (
                <div className="flex items-center justify-between gap-3 border border-orange-300 bg-orange-50 p-4 text-xs text-orange-950 shadow-[inset_4px_0_0_var(--color-orange-700)]">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertTriangle size={16} className="shrink-0 text-orange-700" aria-hidden="true" />
                    <span>{t("tenant.dashboard.unpaidWarning", { count: unpaid.length })}</span>
                  </div>
                  <Link to="/portail/paiements" className="whitespace-nowrap bg-ink-900 px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-orange-700">
                    {t("tenant.dashboard.payNow")}
                  </Link>
                </div>
              )}
            </div>
          </article>
        );
      })}

      {signingContract && (
        <SignatureModal
          signUrl={`/contracts/${signingContract.id}/sign`}
          title={t("tenant.dashboard.leaseTitle", { property: signingContract.property?.title })}
          onSuccess={() => {
            setSigningContract(null);
            load();
          }}
          onClose={() => setSigningContract(null)}
        />
      )}

      {sectionDonneesPersonnelles}

      {viewingLeaseContract && (
        <DocumentModal
          title={t("tenant.dashboard.leaseDocTitle", { property: viewingLeaseContract.property?.title })}
          docUrl={`/documents/lease/${viewingLeaseContract.id}`}
          onClose={() => setViewingLeaseContract(null)}
        />
      )}

      {viewingScannedContract && (
        <ScannedContractModal
          title={viewingScannedContract.title}
          fileUrl={viewingScannedContract.url}
          onClose={() => setViewingScannedContract(null)}
        />
      )}

      {signingInspection && (
        <SignatureModal
          signUrl={`/inspections/${signingInspection.id}/sign`}
          title={t("tenant.dashboard.inspectionDocTitle", { property: signingInspection.property?.title })}
          onSuccess={() => {
            setSigningInspection(null);
            load();
          }}
          onClose={() => setSigningInspection(null)}
        />
      )}

      {viewingReportInspection && (
        <DocumentModal
          title={t("tenant.dashboard.inspectionDocTitle", { property: viewingReportInspection.property?.title })}
          docUrl={`/documents/inspection/${viewingReportInspection.id}`}
          onClose={() => setViewingReportInspection(null)}
        />
      )}
    </div>
  );
}
