import { Building2, Heart } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { fileUrl } from "../api/client";
import { countryLabel } from "../utils/countries";
import type { AnnonceFavorite } from "../utils/favorisVitrine";

const JOUR_MS = 86_400_000;
/** Une annonce publiée depuis moins de deux semaines porte la pastille « Nouveau ». */
const NOUVEAU_JUSQU_A_JOURS = 14;

interface Props {
  annonce: AnnonceFavorite;
  favori: boolean;
  onBasculerFavori: (annonce: AnnonceFavorite) => void;
}

/**
 * Carte d'une annonce de la vitrine : photo (ou plan à défaut) avec le prix posé dessus, titre, lieu, type et surface.
 * Le cœur met l'annonce de côté dans le navigateur du visiteur ; il est frère du lien, jamais enfant (un bouton dans un
 * lien n'est pas valide et se déclencherait en même temps que la navigation).
 */
export default function CarteAnnonce({ annonce, favori, onBasculerFavori }: Props) {
  const { t, i18n } = useTranslation();
  const nouveau = Date.now() - new Date(annonce.createdAt).getTime() < NOUVEAU_JUSQU_A_JOURS * JOUR_MS;

  return (
    <div className="group relative border border-slate-300 bg-white transition-colors hover:border-ink-900">
      <Link to={`/vitrine/annonces/${annonce.id}`} className="block">
        <div className="relative h-44 overflow-hidden border-b border-slate-300 bg-slate-100">
          {annonce.imageUrl ? (
            <img src={fileUrl(annonce.imageUrl) ?? undefined} alt={annonce.title} className="h-full w-full object-cover" />
          ) : (
            <div className="bande-motif absolute inset-0 flex items-center justify-center opacity-25" aria-hidden="true">
              <Building2 size={40} strokeWidth={1.5} className="text-ink-900" />
            </div>
          )}
          <div className="absolute bottom-0 left-0 bg-ink-900 px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-white">
            <span>{`${new Intl.NumberFormat(i18n.language).format(annonce.price)} ${annonce.currency}`}</span>
            {annonce.pricePeriod === "MONTH" && <span className="ml-1 text-[10px] font-normal text-slate-300">{t("vitrine.perMonthShort")}</span>}
          </div>
          <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
            {annonce.featured && (
              <span className="bg-orange-700 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-white">{t("manager.listings.featuredBadge")}</span>
            )}
            {nouveau && (
              <span className="border border-ink-900 bg-white px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-900">{t("vitrine.newBadge")}</span>
            )}
          </div>
        </div>
        <div className="p-4">
          <h3 className="line-clamp-1 text-sm font-bold leading-snug text-slate-900 transition-colors group-hover:text-orange-700">{annonce.title}</h3>
          <p className="mt-1 line-clamp-1 text-xs text-slate-600">
            {annonce.location}
            {annonce.country ? ` · ${countryLabel(annonce.country, i18n.language)}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-dashed border-slate-300 pt-3 font-mono text-[11px] uppercase tracking-wider text-slate-700">
            <span className="border border-slate-300 px-1.5 py-0.5">{t(`manager.listings.types.${annonce.type}`)}</span>
            {annonce.surface != null && <span>{`${annonce.surface} m²`}</span>}
            {annonce.rooms != null && <span>{t("vitrine.roomsCount", { count: annonce.rooms })}</span>}
          </div>
        </div>
      </Link>
      <button
        type="button"
        onClick={() => onBasculerFavori(annonce)}
        aria-pressed={favori}
        aria-label={favori ? t("vitrine.favorites.remove", { title: annonce.title }) : t("vitrine.favorites.add", { title: annonce.title })}
        className="absolute left-2 top-2 flex size-8 cursor-pointer items-center justify-center border border-slate-300 bg-white text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700"
      >
        <Heart size={15} aria-hidden="true" className={favori ? "fill-orange-700 text-orange-700" : ""} />
      </button>
    </div>
  );
}
