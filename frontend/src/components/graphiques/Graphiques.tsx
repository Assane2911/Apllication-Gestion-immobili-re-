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
  borderRadius: "0",
  fontSize: "14px",
  lineHeight: 1.4,
  boxShadow: "none",
  backgroundColor: "#0f172a",
  color: "#f8fafc",
  border: "1px solid rgba(255,255,255,0.1)",
  padding: "10px 14px",
};

/** Montants d'axe abrégés (1,6 M, 400 k) : « 1600000 » n'est pas lisible d'un coup d'œil. */
const abreger = (valeur: number, langue: string) => new Intl.NumberFormat(langue, { notation: "compact", maximumFractionDigits: 1 }).format(valeur);

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
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <defs>
          <Hachure id="hachure-depenses" couleur={COULEUR_DEPENSES} />
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-slate-100" />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: "currentColor" }} className="text-slate-600" />
        <YAxis tick={{ fontSize: 12, fill: "currentColor" }} className="text-slate-600" tickFormatter={(v: number) => abreger(v, i18n.language)} width={52} />
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
        <Bar dataKey="revenue" name="revenue" fill={COULEUR_REVENUS} radius={0} />
        <Bar dataKey="expense" name="expense" fill="url(#hachure-depenses)" stroke={COULEUR_DEPENSES} strokeWidth={1} radius={0} />
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
