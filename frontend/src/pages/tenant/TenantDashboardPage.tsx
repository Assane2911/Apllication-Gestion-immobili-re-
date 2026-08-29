import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fileUrl } from "../../api/client";
import Badge from "../../components/Badge";
import DocumentModal from "../../components/DocumentModal";
import SignatureModal from "../../components/SignatureModal";
import { useCurrency } from "../../context/CurrencyContext";
import type { Contract } from "../../types";

export default function TenantDashboardPage() {
  const { formatMoney } = useCurrency();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [signingContract, setSigningContract] = useState<Contract | null>(null);
  const [viewingLeaseContract, setViewingLeaseContract] = useState<Contract | null>(null);

  function load() {
    api.get<Contract[]>("/contracts/mine").then((res) => setContracts(res.data));
  }

  useEffect(() => {
    load();
  }, []);

  if (contracts.length === 0) {
    return <p className="text-slate-500 dark:text-slate-400 text-sm">Aucun contrat de location n'est associé à votre compte pour le moment.</p>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Mon logement & Mon Bail</h2>
      {contracts.map((c) => {
        const unpaid = (c.invoices ?? []).filter((i) => i.status !== "PAID" && i.status !== "CANCELLED");
        return (
          <div key={c.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="h-40 bg-slate-100 dark:bg-slate-800">
              {c.property?.imageUrl ? (
                <img src={fileUrl(c.property.imageUrl) ?? undefined} alt={c.property.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600 text-4xl">🏠</div>
              )}
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-base">{c.property?.title}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{c.property?.address}</p>
                </div>
                <Badge status={c.status} />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm pt-3 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <p className="text-slate-400 dark:text-slate-500 text-xs">Loyer mensuel</p>
                  <p className="font-bold text-slate-900 dark:text-slate-100">{formatMoney(c.rent, c.currency)}</p>
                </div>
                <div>
                  <p className="text-slate-400 dark:text-slate-500 text-xs">Dépôt de garantie</p>
                  <p className="font-bold text-slate-900 dark:text-slate-100">{formatMoney(c.deposit, c.currency)}</p>
                </div>
                <div>
                  <p className="text-slate-400 dark:text-slate-500 text-xs">Début du contrat</p>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{new Date(c.startDate).toLocaleDateString("fr-FR")}</p>
                </div>
                <div>
                  <p className="text-slate-400 dark:text-slate-500 text-xs">Fin du contrat</p>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{new Date(c.endDate).toLocaleDateString("fr-FR")}</p>
                </div>
              </div>

              {/* État de la signature du bail */}
              <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-3.5 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">✍️</span>
                  <div>
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Signature du contrat de bail</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {c.signedByTenantAt ? (
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                          ✅ Signé par vous le {new Date(c.signedByTenantAt).toLocaleDateString("fr-FR")}
                        </span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400 font-medium">En attente de votre signature numérique</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!c.signedByTenantAt && (
                    <button
                      onClick={() => setSigningContract(c)}
                      className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3.5 py-2 rounded-lg shadow-sm transition-colors cursor-pointer"
                    >
                      ✍️ Signer mon bail
                    </button>
                  )}
                  <button
                    onClick={() => setViewingLeaseContract(c)}
                    className="bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 text-xs font-semibold px-3 py-2 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1"
                  >
                    <span>📄</span> Voir le bail PDF
                  </button>
                </div>
              </div>

              {unpaid.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs rounded-xl p-3 flex items-center justify-between">
                  <span>⚠️ Vous avez {unpaid.length} mensualité(s) de loyer en attente de règlement.</span>
                  <Link to="/portail/paiements" className="underline font-bold text-amber-900 dark:text-amber-300 hover:text-amber-950 dark:hover:text-amber-200">
                    Régler maintenant →
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
          contractTitle={`Bail - ${signingContract.property?.title}`}
          onSuccess={() => {
            setSigningContract(null);
            load();
          }}
          onClose={() => setSigningContract(null)}
        />
      )}

      {viewingLeaseContract && (
        <DocumentModal
          title={`Contrat de Bail - ${viewingLeaseContract.property?.title}`}
          docUrl={`/documents/lease/${viewingLeaseContract.id}`}
          onClose={() => setViewingLeaseContract(null)}
        />
      )}
    </div>
  );
}

