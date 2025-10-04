import { fetch } from 'undici';
import { OPEN_LIBRARY_ENDPOINT } from './constants';
import { logDebug, logError } from './logger';
import { NormalizedCsvRow, OpenLibraryLookupOutput, OpenLibraryResponse } from './types';

const HARRY_POTTER_TOKEN = 'harry potter';
const ROWLING_TOKEN = 'rowling';
const LOTR_TOKEN = 'lord of the rings';
const LOTR_KEYWORDS = ['fellowship', 'two towers', 'return of the king'];

export function buildSeriesKey(author: string | undefined, seriesName: string | undefined): string {
  const safeAuthor = (author ?? 'unknown-author').toLowerCase().trim();
  const safeSeries = (seriesName ?? 'unknown-series').toLowerCase().trim();
  return `${safeAuthor}|${safeSeries}`;
}

export function extractSeriesPosition(raw?: string): number | null {
  if (!raw) return null;
  const match = raw.match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function normaliseSeriesName(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const cleaned = raw.replace(/[#()]/g, '').trim();
  const withoutTrailingNumber = cleaned.replace(/\s+\d+$/, '').trim();
  const result = withoutTrailingNumber.length > 0 ? withoutTrailingNumber : cleaned;
  return result.length > 0 ? result : fallback;
}

export function inferSeriesFromDoc(
  row: NormalizedCsvRow,
  response?: OpenLibraryResponse
): { seriesName: string; seriesPos: number | null } {
  const doc = response?.docs?.[0];
  const fallbackTitle = row.title?.trim() || row.asin || 'Unknown Title';

  if (doc?.series?.length) {
    const primary = doc.series[0];
    return {
      seriesName: normaliseSeriesName(primary, fallbackTitle),
      seriesPos: extractSeriesPosition(primary)
    };
  }

  const titleLower = (row.title ?? '').toLowerCase();
  const authorLower = (row.author ?? '').toLowerCase();

  if (titleLower.includes(HARRY_POTTER_TOKEN) || authorLower.includes(ROWLING_TOKEN)) {
    return { seriesName: 'Harry Potter', seriesPos: null };
  }

  const isLotr =
    titleLower.includes(LOTR_TOKEN) ||
    LOTR_KEYWORDS.some((token) => titleLower.includes(token)) ||
    authorLower.includes('tolkien');

  if (isLotr) {
    return { seriesName: 'The Lord of the Rings', seriesPos: null };
  }

  return { seriesName: fallbackTitle, seriesPos: null };
}

async function queryOpenLibrary(row: NormalizedCsvRow): Promise<OpenLibraryResponse | undefined> {
  const url = new URL(OPEN_LIBRARY_ENDPOINT);
  url.searchParams.set('title', row.title);
  url.searchParams.set('author', row.author);
  url.searchParams.set('limit', '5');

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      logError('Open Library request failed', { status: response.status });
      return undefined;
    }

    const payload = (await response.json()) as OpenLibraryResponse;
    logDebug('Open Library response received', { docs: payload.docs?.length ?? 0 });
    return payload;
  } catch (error) {
    logError('Open Library lookup errored', { error });
    return undefined;
  }
}

export async function lookupSeriesMetadata(row: NormalizedCsvRow, response?: OpenLibraryResponse): Promise<OpenLibraryLookupOutput> {
  const apiResponse = response ?? (await queryOpenLibrary(row));
  const { seriesName, seriesPos } = inferSeriesFromDoc(row, apiResponse);
  return {
    ...row,
    seriesName,
    seriesPos,
    seriesKey: buildSeriesKey(row.author, seriesName)
  };
}
