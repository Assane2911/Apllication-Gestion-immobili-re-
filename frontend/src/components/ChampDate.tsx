import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

/**
 * Champ date de l'application. C'est un vrai `<input type="date">` (mêmes propriétés, même événement `onChange`, saisie
 * au clavier par segments) ; seul le calendrier change : sur un écran à souris, un clic sur l'icône ouvre un calendrier
 * aux couleurs du plan au lieu de celui, non stylable, du navigateur. Sur téléphone et tablette (pointeur grossier), le
 * sélecteur natif reste en place : c'est le plus adapté au doigt.
 */
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

const LARGEUR = 288;
const HAUTEUR = 340;

const enTexte = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function enDate(texte: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texte ?? "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
const decaler = (d: Date, jours: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + jours);
const souris = () => typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;

export default function ChampDate({ onClick, ...champ }: Props) {
  const { t, i18n } = useTranslation();
  const saisie = useRef<HTMLInputElement>(null);
  const calendrier = useRef<HTMLDivElement>(null);
  const [ouvert, setOuvert] = useState(false);
  const [position, setPosition] = useState({ haut: 0, gauche: 0 });
  const valeur = enDate(typeof champ.value === "string" ? champ.value : undefined);
  const aujourdhui = new Date();
  const [mois, setMois] = useState(() => new Date((valeur ?? aujourdhui).getFullYear(), (valeur ?? aujourdhui).getMonth(), 1));
  const [jourActif, setJourActif] = useState<Date>(valeur ?? aujourdhui);
  const min = enDate(typeof champ.min === "string" ? champ.min : undefined);
  const max = enDate(typeof champ.max === "string" ? champ.max : undefined);
  const permis = (d: Date) => (!min || d >= min) && (!max || d <= max);

  const placer = useCallback(() => {
    const el = saisie.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const hauteur = calendrier.current?.offsetHeight || HAUTEUR;
    const dessous = r.bottom + 4 + hauteur <= window.innerHeight || r.top < hauteur;
    setPosition({
      haut: dessous ? r.bottom + 4 : r.top - hauteur - 4,
      gauche: Math.max(8, Math.min(r.left, window.innerWidth - LARGEUR - 8)),
    });
  }, []);

  const fermer = useCallback((rendreLeFocus: boolean) => {
    setOuvert(false);
    if (rendreLeFocus) saisie.current?.focus();
  }, []);

  const poser = (texte: string) => {
    const el = saisie.current;
    if (!el) return;
    // React ne voit un changement fait par programme que s'il passe par le réglage natif de `value`, puis un événement.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, texte);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const ouvrir = () => {
    const depart = valeur ?? aujourdhui;
    setMois(new Date(depart.getFullYear(), depart.getMonth(), 1));
    setJourActif(depart);
    placer();
    setOuvert(true);
  };

  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: PointerEvent) => {
      const cible = e.target as Node;
      if (!calendrier.current?.contains(cible) && !saisie.current?.contains(cible)) fermer(false);
    };
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") {
        // Avant la fenêtre modale qui contient le champ : Échap ne referme que le calendrier.
        e.stopImmediatePropagation();
        if (e.key === "Tab") e.preventDefault();
        fermer(true);
      }
    };
    document.addEventListener("pointerdown", dehors);
    document.addEventListener("keydown", surTouche, true);
    window.addEventListener("resize", placer);
    window.addEventListener("scroll", placer, true);
    return () => {
      document.removeEventListener("pointerdown", dehors);
      document.removeEventListener("keydown", surTouche, true);
      window.removeEventListener("resize", placer);
      window.removeEventListener("scroll", placer, true);
    };
  }, [ouvert, fermer, placer]);

  // Un mois de six semaines est plus haut qu'un mois de cinq : on replace le calendrier après chaque changement.
  useEffect(() => {
    if (ouvert) placer();
  }, [ouvert, mois, placer]);

  // Le focus suit le jour actif pour que les flèches se lisent à l'écran et au lecteur d'écran.
  useEffect(() => {
    if (ouvert) calendrier.current?.querySelector<HTMLButtonElement>(`[data-jour="${enTexte(jourActif)}"]`)?.focus();
  }, [ouvert, jourActif, mois]);

  const aller = (d: Date) => {
    setJourActif(d);
    if (d.getMonth() !== mois.getMonth() || d.getFullYear() !== mois.getFullYear()) setMois(new Date(d.getFullYear(), d.getMonth(), 1));
  };
  const surToucheJour = (e: React.KeyboardEvent) => {
    const pas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in pas) {
      e.preventDefault();
      aller(decaler(jourActif, pas[e.key]));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      aller(new Date(jourActif.getFullYear(), jourActif.getMonth() + (e.key === "PageUp" ? -1 : 1), Math.min(jourActif.getDate(), 28)));
    }
  };

  const premier = new Date(mois.getFullYear(), mois.getMonth(), 1);
  const decalage = (premier.getDay() + 6) % 7; // semaine qui commence le lundi
  const nbJours = new Date(mois.getFullYear(), mois.getMonth() + 1, 0).getDate();
  const cases: Array<Date | null> = [
    ...Array.from({ length: decalage }, () => null),
    ...Array.from({ length: nbJours }, (_, i) => new Date(mois.getFullYear(), mois.getMonth(), i + 1)),
  ];
  const lundi = new Date(2024, 0, 1);
  const nomsJours = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(decaler(lundi, i)).slice(0, 2));
  const titreMois = new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }).format(mois);

  return (
    <>
      <input
        {...champ}
        ref={saisie}
        type="date"
        onClick={(e) => {
          onClick?.(e);
          const r = e.currentTarget.getBoundingClientRect();
          // Seule l'icône (extrémité droite) ouvre le calendrier ; ailleurs, on saisit au clavier, segment par segment.
          if (!e.defaultPrevented && souris() && !champ.disabled && !champ.readOnly && e.clientX >= r.right - 36) {
            e.preventDefault();
            ouvert ? fermer(false) : ouvrir();
          }
        }}
      />
      {ouvert &&
        createPortal(
          <div
            ref={calendrier}
            role="dialog"
            aria-label={t("common.calendar.choose")}
            style={{ top: position.haut, left: position.gauche, width: LARGEUR }}
            className="fixed z-[70] border-[1.5px] border-ink-900 bg-white text-slate-900 shadow-lg"
          >
            <div aria-hidden="true" className="bande-motif h-1.5" />
            <div className="flex items-center justify-between gap-2 border-b border-slate-300 px-3 py-2">
              <button
                type="button"
                aria-label={t("common.calendar.previous")}
                onClick={() => setMois(new Date(mois.getFullYear(), mois.getMonth() - 1, 1))}
                className="flex h-7 w-7 items-center justify-center border border-slate-300 text-ink-900 hover:bg-slate-100 cursor-pointer"
              >
                <ChevronLeft size={15} aria-hidden="true" />
              </button>
              <p aria-live="polite" className="text-sm font-semibold capitalize">{titreMois}</p>
              <button
                type="button"
                aria-label={t("common.calendar.next")}
                onClick={() => setMois(new Date(mois.getFullYear(), mois.getMonth() + 1, 1))}
                className="flex h-7 w-7 items-center justify-center border border-slate-300 text-ink-900 hover:bg-slate-100 cursor-pointer"
              >
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-px px-3 pt-2 text-center font-mono text-[10px] uppercase text-slate-600" aria-hidden="true">
              {nomsJours.map((nom, i) => (
                <span key={i} className="py-1">{nom}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px px-3 pb-2" onKeyDown={surToucheJour}>
              {cases.map((jour, i) => {
                if (!jour) return <span key={`vide-${i}`} />;
                const texte = enTexte(jour);
                const choisi = valeur ? texte === enTexte(valeur) : false;
                const estAujourdhui = texte === enTexte(aujourdhui);
                const actif = texte === enTexte(jourActif);
                return (
                  <button
                    key={texte}
                    type="button"
                    data-jour={texte}
                    tabIndex={actif ? 0 : -1}
                    disabled={!permis(jour)}
                    aria-pressed={choisi}
                    aria-current={estAujourdhui ? "date" : undefined}
                    onClick={() => {
                      poser(texte);
                      fermer(true);
                    }}
                    className={`h-8 text-sm tabular-nums cursor-pointer disabled:cursor-not-allowed disabled:text-slate-300 ${
                      choisi
                        ? "bg-ink-900 font-semibold text-white"
                        : `hover:bg-slate-100 ${estAujourdhui ? "border-[1.5px] border-ocre font-semibold" : ""}`
                    }`}
                  >
                    {jour.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between border-t border-slate-300 px-3 py-2 font-mono text-[11px] uppercase tracking-wider">
              {champ.required ? (
                <span />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    poser("");
                    fermer(true);
                  }}
                  className="text-slate-700 hover:text-ink-900 cursor-pointer"
                >
                  {t("common.calendar.clear")}
                </button>
              )}
              <button
                type="button"
                disabled={!permis(aujourdhui)}
                onClick={() => {
                  poser(enTexte(aujourdhui));
                  fermer(true);
                }}
                className="font-semibold text-orange-700 hover:text-ink-900 disabled:text-slate-300 disabled:cursor-not-allowed cursor-pointer"
              >
                {t("common.calendar.today")}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
