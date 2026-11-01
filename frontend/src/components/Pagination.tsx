import { useTranslation } from "react-i18next";

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ page, totalPages, total, onPageChange }: PaginationProps) {
  const { t } = useTranslation();

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap px-1">
      <p className="text-xs text-slate-600">{t("common.pagination.totalItems", { count: total })}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="text-xs font-semibold px-3 py-1.5 border border-slate-400 text-slate-800 bg-white hover:border-ink-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {t("common.pagination.previous")}
        </button>
        <span className="text-xs text-slate-600 px-1 whitespace-nowrap">
          {t("common.pagination.pageOf", { page, totalPages })}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="text-xs font-semibold px-3 py-1.5 border border-slate-400 text-slate-800 bg-white hover:border-ink-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {t("common.pagination.next")}
        </button>
      </div>
    </div>
  );
}
