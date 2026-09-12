import { Building2, Calendar, CheckCircle2, Clock, CreditCard, FileCheck, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, fileUrl } from "../../api/client";
import Badge from "../../components/Badge";
import DocumentModal from "../../components/DocumentModal";
import ScannedContractModal from "../../components/ScannedContractModal";
import SignatureModal from "../../components/SignatureModal";
import { useCurrency } from "../../context/currency";
import type { Contract } from "../../types";

export default function TenantDashboardPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [signingContract, setSigningContract] = useState<Contract | null>(null);
  const [viewingLeaseContract, setViewingLeaseContract] = useState<Contract | null>(null);
  const [viewingScannedContract, setViewingScannedContract] = useState<{ title: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<Contract[]>("/contracts/mine")
      .then((res) => {
        setContracts(res.data);
        setError(null);
      })
      .catch((err) => setError(apiErrorMessage(err)));
  }

  useEffect(() => {
    load();
  }, []);

  if (error) {
    return (
      <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 p-6 rounded-2xl shadow-xs">
        <p className="text-sm">{error}</p>
        <button
          onClick={load}
          className="mt-4 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors cursor-pointer"
        >
          {t("common.actions.retry")}
        </button>
      </div>
    );
  }

  if (contracts.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 p-8 text-center shadow-xs">
        <div className="w-12 h-12 rounded-2xl bg-brand-50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-400 flex items-center justify-center mx-auto mb-3 text-2xl">
          🏠
        </div>
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{t("tenant.dashboard.noContract")}</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Votre gestionnaire n'a pas encore rattaché de bail à votre compte.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-brand-950 to-slate-900 text-white p-6 sm:p-7 shadow-md border border-slate-800">
        <div className="absolute -right-8 -bottom-8 w-44 h-44 rounded-full bg-brand-500/15 blur-2xl pointer-events-none" />
        <div className="relative z-10">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-500/20 border border-brand-400/30 text-[11px] font-semibold text-brand-300 mb-2.5">
            <ShieldCheck size={13} className="text-emerald-400" />
            Portail locataire vérifié
          </div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">{t("tenant.dashboard.title")}</h2>
          <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-xl">
            Retrouvez toutes les informations sur votre bail, vos quittances officielles et le règlement simplifié de vos loyers.
          </p>
        </div>
      </div>

      {contracts.map((c) => {
        const unpaid = (c.invoices ?? []).filter((i) => i.status !== "PAID" && i.status !== "CANCELLED");
        return (
          <div
            key={c.id}
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xs hover:shadow-md transition-all duration-200 overflow-hidden"
          >
            {/* Property Photo Header */}
            <div className="relative h-48 sm:h-56 bg-slate-100 dark:bg-slate-800 overflow-hidden">
              {c.property?.imageUrl ? (
                <img
                  src={fileUrl(c.property.imageUrl) ?? undefined}
                  alt={c.property.title}
                  className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600 text-5xl">
                  🏠
                </div>
              )}
              {/* Gradient Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent pointer-events-none" />
              <div className="absolute top-4 right-4 z-10">
                <Badge status={c.status} />
              </div>
              <div className="absolute bottom-4 left-4 right-4 z-10 text-white">
                <div className="flex items-center gap-1.5 text-xs text-brand-200 font-medium mb-0.5">
                  <Building2 size={13} />
                  <span>Logement principal</span>
                </div>
                <h3 className="font-bold text-lg sm:text-xl text-white tracking-tight drop-shadow-xs">{c.property?.title}</h3>
                <p className="text-xs text-slate-300 drop-shadow-xs">{c.property?.address}</p>
              </div>
            </div>

            <div className="p-5 sm:p-6 space-y-5">
              {/* Key Figures Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-50/80 dark:bg-slate-800/50 rounded-xl p-3.5 border border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-1 text-slate-400 dark:text-slate-500 text-xs mb-1">
                    <CreditCard size={13} />
                    <span>{t("tenant.dashboard.monthlyRent")}</span>
                  </div>
                  <p className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                    {formatMoney(c.rent, c.currency)}
                  </p>
                </div>
                <div className="bg-slate-50/80 dark:bg-slate-800/50 rounded-xl p-3.5 border border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-1 text-slate-400 dark:text-slate-500 text-xs mb-1">
                    <ShieldCheck size={13} />
                    <span>{t("tenant.dashboard.deposit")}</span>
                  </div>
                  <p className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                    {formatMoney(c.deposit, c.currency)}
                  </p>
                </div>
                <div className="bg-slate-50/80 dark:bg-slate-800/50 rounded-xl p-3.5 border border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-1 text-slate-400 dark:text-slate-500 text-xs mb-1">
                    <Calendar size={13} />
                    <span>{t("tenant.dashboard.startDate")}</span>
                  </div>
                  <p className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {new Date(c.startDate).toLocaleDateString(i18n.language)}
                  </p>
                </div>
                <div className="bg-slate-50/80 dark:bg-slate-800/50 rounded-xl p-3.5 border border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-1 text-slate-400 dark:text-slate-500 text-xs mb-1">
                    <Clock size={13} />
                    <span>{t("tenant.dashboard.endDate")}</span>
                  </div>
                  <p className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {new Date(c.endDate).toLocaleDateString(i18n.language)}
                  </p>
                </div>
              </div>

              {/* État de la signature du bail */}
              <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200/90 dark:border-slate-700/80 rounded-xl p-4 flex items-center justify-between flex-wrap gap-3.5 shadow-2xs">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-base ${c.signedByTenantAt ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400" : "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"}`}>
                    {c.signedByTenantAt ? <CheckCircle2 size={18} /> : "✍️"}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100">{t("tenant.dashboard.signatureTitle")}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {c.signedByTenantAt ? (
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                          {t("tenant.dashboard.signedOn", { date: new Date(c.signedByTenantAt).toLocaleDateString(i18n.language) })}
                        </span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400 font-semibold">{t("tenant.dashboard.awaitingSignature")}</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!c.signedByTenantAt && (
                    <button
                      onClick={() => setSigningContract(c)}
                      className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-xs shadow-brand-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                    >
                      ✍️ {t("tenant.dashboard.signMyLease")}
                    </button>
                  )}
                  <button
                    onClick={() => setViewingLeaseContract(c)}
                    className="bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 text-xs font-semibold px-3.5 py-2 rounded-xl transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-2xs"
                  >
                    <span>📄</span> {t("tenant.dashboard.viewLeasePdf")}
                  </button>

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
                      className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-500/30 text-xs font-semibold px-3.5 py-2 rounded-xl transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-2xs"
                    >
                      <FileCheck size={14} />
                      <span>{t("tenant.dashboard.viewScannedLease")}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Unpaid Alerts */}
              {unpaid.length > 0 && (
                <div className="bg-gradient-to-r from-amber-50 to-amber-100/60 dark:from-amber-500/10 dark:to-amber-500/5 border border-amber-200 dark:border-amber-500/30 text-amber-900 dark:text-amber-300 text-xs rounded-xl p-4 flex items-center justify-between gap-3 shadow-2xs">
                  <div className="flex items-center gap-2 font-medium">
                    <span className="text-base">⚠️</span>
                    <span>{t("tenant.dashboard.unpaidWarning", { count: unpaid.length })}</span>
                  </div>
                  <Link
                    to="/portail/paiements"
                    className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3.5 py-1.5 rounded-lg text-xs shadow-2xs hover:scale-[1.02] active:scale-[0.98] transition-all"
                  >
                    {t("tenant.dashboard.payNow")}
                  </Link>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {signingContract && (
        <SignatureModal
          contractId={signingContract.id}
          contractTitle={t("tenant.dashboard.leaseTitle", { property: signingContract.property?.title })}
          onSuccess={() => {
            setSigningContract(null);
            load();
          }}
          onClose={() => setSigningContract(null)}
        />
      )}

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
    </div>
  );
}
