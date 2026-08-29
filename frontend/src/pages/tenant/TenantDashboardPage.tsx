import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fileUrl } from "../../api/client";
import Badge from "../../components/Badge";
import { useCurrency } from "../../context/CurrencyContext";
import type { Contract } from "../../types";

export default function TenantDashboardPage() {
  const { formatMoney } = useCurrency();
  const [contracts, setContracts] = useState<Contract[]>([]);

  useEffect(() => {
    api.get<Contract[]>("/contracts/mine").then((res) => setContracts(res.data));
  }, []);

  if (contracts.length === 0) {
    return <p className="text-slate-500 text-sm">Aucun contrat de location n'est associé à votre compte pour le moment.</p>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-slate-900">Mon logement</h2>
      {contracts.map((c) => {
        const unpaid = (c.invoices ?? []).filter((i) => i.status !== "PAID" && i.status !== "CANCELLED");
        return (
          <div key={c.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="h-40 bg-slate-100">
              {c.property?.imageUrl ? (
                <img src={fileUrl(c.property.imageUrl) ?? undefined} alt={c.property.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-300 text-4xl">🏠</div>
              )}
            </div>
            <div className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium text-slate-900">{c.property?.title}</h3>
                  <p className="text-sm text-slate-500">{c.property?.address}</p>
                </div>
                <Badge status={c.status} />
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm pt-2 border-t border-slate-100">
                <div>
                  <p className="text-slate-400 text-xs">Loyer mensuel</p>
                  <p className="font-semibold text-slate-900">{formatMoney(c.rent, c.currency)}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Dépôt de garantie</p>
                  <p className="font-semibold text-slate-900">{formatMoney(c.deposit, c.currency)}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Début du contrat</p>
                  <p className="font-medium text-slate-900">{new Date(c.startDate).toLocaleDateString("fr-FR")}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Fin du contrat</p>
                  <p className="font-medium text-slate-900">{new Date(c.endDate).toLocaleDateString("fr-FR")}</p>
                </div>
              </div>
              {unpaid.length > 0 && (
                <div className="bg-amber-50 text-amber-700 text-sm rounded-lg px-3 py-2 flex items-center justify-between">
                  <span>{unpaid.length} facture(s) en attente de paiement</span>
                  <Link to="/portail/paiements" className="underline font-medium">Payer</Link>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
