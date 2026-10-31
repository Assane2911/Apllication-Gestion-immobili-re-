import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useCurrency } from "../../context/currency";
import type { PropertyStatus } from "../../types";
import { COULEUR_DEPENSES, COULEUR_REVENUS, COULEURS_STATUT } from "./couleurs";

/**
 * Tous les graphiques de l'application. Ce fichier est le SEUL à importer `recharts` (≈ 380 Ko avant compression) :
 * les pages le chargent à la demande (voir `graphiquesALaDemande.ts`), pour que leurs chiffres s'affichent sans
 * attendre la bibliothèque. Un test interdit à une page d'importer `recharts` directement.
 */
const STYLE_INFOBULLE = {
  borderRadius: "14px",
  fontSize: "14px",
  lineHeight: 1.4,
  boxShadow: "0 10px 25px -5px rgba(0,0,0,0.15)",
  backgroundColor: "#0f172a",
  color: "#f8fafc",
  border: "1px solid rgba(255,255,255,0.1)",
  padding: "10px 14px",
};

/** Hachure diagonale d'une couleur : les dépenses se lisent « au trait », les revenus restent pleins, comme sur un plan. */
function Hachure({ id, couleur }: { id: string; couleur: string }) {
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" fill={couleur} fillOpacity="0.14" />
      <rect width="2.5" height="6" fill={couleur} />
    </pattern>
  );
}

/** Revenus et dépenses par mois, dans une devise (tableau de bord). */
export function GraphiqueRevenusDepenses({ data, currency }: { data: Array<{ month: string; revenue: number; expense: number }>; currency: string }) {
  const { t } = useTranslation();
  const { formatMoney } = useCurrency();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <defs>
          <Hachure id="hachure-depenses" couleur={COULEUR_DEPENSES} />
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-slate-100" />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: "currentColor" }} className="text-slate-600" />
        <YAxis tick={{ fontSize: 12, fill: "currentColor" }} className="text-slate-600" />
        <Tooltip
          formatter={(value: any, name: any) => [
            formatMoney(Number(value), currency),
            name === "revenue" ? t("manager.dashboard.charts.tooltipRevenue") : t("manager.dashboard.charts.tooltipExpense"),
          ]}
          contentStyle={{ ...STYLE_INFOBULLE, backgroundColor: "var(--tw-tooltip-bg, #0f172a)" }}
          itemStyle={{ color: "#f8fafc" }}
        />
        <Legend
          formatter={(value) => (value === "revenue" ? t("manager.dashboard.charts.legendRevenue") : t("manager.dashboard.charts.legendExpense"))}
          wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
        />
        <Bar dataKey="revenue" name="revenue" fill={COULEUR_REVENUS} radius={[2, 2, 0, 0]} />
        <Bar dataKey="expense" name="expense" fill="url(#hachure-depenses)" stroke={COULEUR_DEPENSES} strokeWidth={1} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Répartition du parc par statut (tableau de bord). */
export function GraphiqueParc({ data, libelles }: { data: Array<{ status: PropertyStatus; value: number }>; libelles: Record<PropertyStatus, string> }) {
  const { t } = useTranslation();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="status" innerRadius={55} outerRadius={80} paddingAngle={4}>
          {data.map((entry) => (
            <Cell key={entry.status} fill={COULEURS_STATUT[entry.status]} stroke="none" />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: any, _name: any, item: any) => [
            t("manager.dashboard.charts.propertiesCount", { count: value }),
            libelles[item.payload.status as PropertyStatus],
          ]}
          contentStyle={{ ...STYLE_INFOBULLE, padding: "8px 12px" }}
          itemStyle={{ color: "#f8fafc" }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

const COULEURS_REVENUS_FISCAL = ["#124a73", "#d9480f", "#2b8a6e", "#6a7f8a"];
const COULEURS_DEPENSES_FISCAL = ["#f59e0b", "#ea580c", "#65a30d", "#a16207"];

/** Revenus et dépenses de l'année par mois, une paire de barres par devise (bilan fiscal). */
export function GraphiqueComparaisonFiscale({ data, devises }: { data: Array<Record<string, number | string>>; devises: string[] }) {
  const { t } = useTranslation();
  const { formatMoney } = useCurrency();
  const plusieurs = devises.length > 1;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <defs>
          {COULEURS_DEPENSES_FISCAL.map((couleur, idx) => (
            <Hachure key={couleur} id={`hachure-fiscal-${idx}`} couleur={couleur} />
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-slate-100" />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: "currentColor" }} className="text-slate-600" />
        <YAxis tick={{ fontSize: 12, fill: "currentColor" }} className="text-slate-600" />
        <Tooltip
          formatter={(value: number | string, name: string) => {
            const [kind, currency] = String(name).split("_");
            const label = kind === "revenue" ? t("manager.fiscal.charts.tooltipRevenue") : t("manager.fiscal.charts.tooltipExpense");
            return [formatMoney(Number(value), currency), plusieurs ? `${label} (${currency})` : label];
          }}
          contentStyle={STYLE_INFOBULLE}
          itemStyle={{ color: "#f8fafc" }}
        />
        <Legend
          formatter={(value) => {
            const [kind, currency] = String(value).split("_");
            const label = kind === "revenue" ? t("manager.fiscal.charts.legendRevenue") : t("manager.fiscal.charts.legendExpense");
            return plusieurs ? `${label} (${currency})` : label;
          }}
          wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
        />
        {devises.map((currency, idx) => (
          <Fragment key={currency}>
            <Bar dataKey={`revenue_${currency}`} name={`revenue_${currency}`} fill={COULEURS_REVENUS_FISCAL[idx % COULEURS_REVENUS_FISCAL.length]} radius={[2, 2, 0, 0]} />
            <Bar dataKey={`expense_${currency}`} name={`expense_${currency}`} fill={`url(#hachure-fiscal-${idx % COULEURS_DEPENSES_FISCAL.length})`} stroke={COULEURS_DEPENSES_FISCAL[idx % COULEURS_DEPENSES_FISCAL.length]} strokeWidth={1} radius={[2, 2, 0, 0]} />
          </Fragment>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
