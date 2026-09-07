import { Request } from "express";

// Valeurs par défaut et bornes de sécurité pour la pagination des listes
// (biens, locataires, contrats, factures, dépenses, incidents côté
// gestionnaire). Un pageSize plafonné évite qu'un appelant ne demande
// "tout d'un coup" (ex. ?pageSize=999999) et retombe dans le problème que
// la pagination est censée résoudre.
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface PaginationParams {
  page: number;
  pageSize: number;
  offset: number;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Lit `page`/`pageSize` depuis la query string d'une requête de liste. */
export function parsePagination(req: Request): PaginationParams {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const rawPageSize = Number.parseInt(String(req.query.pageSize ?? String(DEFAULT_PAGE_SIZE)), 10) || DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawPageSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function buildPaginatedResult<T>(items: T[], total: number, { page, pageSize }: PaginationParams): PaginatedResult<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
