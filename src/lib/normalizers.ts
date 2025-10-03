import { NormalizedCsvRow } from './types';

export interface RawCsvRow {
  Title: string;
  Author: string;
  ASIN: string;
  PurchaseDate: string;
}

export function normalizeCsvRow(row: RawCsvRow): NormalizedCsvRow {
  return {
    title: row.Title.trim(),
    author: row.Author.trim(),
    asin: row.ASIN.trim(),
    purchasedAt: row.PurchaseDate,
    statusDefault: 'Not started',
    source: 'Audible'
  };
}
