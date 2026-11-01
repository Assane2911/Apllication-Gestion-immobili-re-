import { useTranslation } from "react-i18next";

interface Props {
  /** Nom de l'espace (gestionnaire, locataire, propriétaire, administration). */
  espace: string;
  /** Nom de la page affichée. */
  page: string;
  /** Rang de la page dans le menu de l'espace (à partir de 1) et nombre total de pages du menu. */
  rang: number;
  total: number;
}

/**
 * Cartouche de feuille, en pied de plan : le bloc d'identification qu'un architecte pose en bas de chaque planche. Il
 * porte le projet, l'espace, la page, la date et le numéro de feuille (le rang de la page dans le menu). Purement
 * décoratif : le texte vient du menu et du titre de la page, il ne leur ajoute rien pour un lecteur d'écran.
 */
export default function CartouchePlan({ espace, page, rang, total }: Props) {
  const { t, i18n } = useTranslation();
  const date = new Intl.DateTimeFormat(i18n.language, { day: "2-digit", month: "short", year: "numeric" }).format(new Date());
  const cases = [
    { cle: "project", libelle: t("common.cartouche.project"), valeur: t("common.appName") },
    { cle: "space", libelle: t("common.cartouche.space"), valeur: espace },
    { cle: "page", libelle: t("common.cartouche.page"), valeur: page },
    { cle: "date", libelle: t("common.cartouche.date"), valeur: date },
  ];

  return (
    <div aria-hidden="true" className="mt-10 mb-14 border-[1.5px] border-ink-900 bg-white font-mono">
      {/* Bande hachurée : le filet décoratif qui ouvre le cartouche. */}
      <div className="bande-motif h-2 border-b-[1.5px] border-ink-900 opacity-70" />
      <div className="grid grid-cols-2 gap-px bg-ink-900 md:grid-cols-[1.3fr_1fr_1.5fr_1fr_auto]">
        {cases.map((c, i) => (
          <div key={c.cle} className={`min-w-0 bg-white px-4 py-2.5 ${i === 2 ? "col-span-2 md:col-span-1" : ""}`}>
            <p className="text-[9px] uppercase tracking-[0.2em] text-slate-500">{c.libelle}</p>
            <p className="mt-0.5 truncate text-xs font-medium uppercase tracking-wider text-ink-900">{c.valeur}</p>
          </div>
        ))}
        <div className="flex items-center gap-3 bg-ink-900 px-5 py-2.5 text-white">
          <div>
            <p className="text-[9px] uppercase tracking-[0.2em] text-white/70">{t("common.sheet")}</p>
            <p className="mt-0.5 text-lg font-bold leading-none tabular-nums">
              {String(rang).padStart(2, "0")}
              <span className="text-xs font-normal text-white/70"> / {String(total).padStart(2, "0")}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
