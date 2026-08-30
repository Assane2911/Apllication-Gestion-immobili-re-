import { Building2, FileText, Receipt, Search, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { SearchResultItem, SearchResultType } from "../types";

const iconByType: Record<SearchResultType, typeof Search> = {
  tenant: Users,
  property: Building2,
  contract: FileText,
  invoice: Receipt,
};

/** Barre de recherche unique (locataires, biens, contrats, factures) affichée
 * dans l'en-tête de l'espace gestionnaire — requête debouncée à 300ms. */
export default function GlobalSearch() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      api
        .get<{ query: string; results: SearchResultItem[] }>("/search", { params: { q: query.trim() } })
        .then((res) => setResults(res.data.results))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function goTo(item: SearchResultItem) {
    setOpen(false);
    setQuery("");
    navigate(item.link);
  }

  return (
    <div className="relative flex-1 max-w-md" ref={containerRef}>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={t("components.globalSearch.placeholder")}
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-8 py-2 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 shadow-sm"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setResults([]);
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            aria-label={t("components.globalSearch.clearAria")}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 mt-2 max-h-96 overflow-y-auto bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-lg z-50">
          {loading ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-6">{t("components.globalSearch.searching")}</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-6">{t("components.globalSearch.noResults", { query })}</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {results.map((r) => {
                const Icon = iconByType[r.type];
                return (
                  <li key={`${r.type}-${r.id}`}>
                    <button
                      onClick={() => goTo(r)}
                      className="w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
                    >
                      <Icon size={16} className="mt-0.5 text-brand-600 dark:text-brand-400 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm text-slate-900 dark:text-slate-100 font-medium truncate">{r.title}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
                          {t(`components.globalSearch.types.${r.type}`)} • {r.subtitle}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
