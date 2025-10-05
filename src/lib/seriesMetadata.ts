import { NormalizedCsvRow, SeriesMetadataResult } from './types';

export function buildSeriesKey(author: string | undefined, seriesName: string | undefined): string {
  const safeAuthor = (author ?? 'unknown-author').toLowerCase().trim();
  const safeSeries = (seriesName ?? 'unknown-series').toLowerCase().trim();
  return `${safeAuthor}|${safeSeries}`;
}

export async function lookupSeriesMetadata(row: NormalizedCsvRow): Promise<SeriesMetadataResult> {
  const hasHint = typeof row.seriesNameHint === 'string' && row.seriesNameHint.trim().length > 0;
  const seriesName = hasHint ? row.seriesNameHint!.trim() : row.title;
  const seriesPos = hasHint ? row.seriesSequenceHint ?? null : null;

  return {
    ...row,
    seriesName,
    seriesPos,
    seriesKey: buildSeriesKey(row.author, seriesName),
    seriesMatch: hasHint
  };
}
