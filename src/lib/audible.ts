import { promises as fs } from 'fs';
import { parse } from 'csv-parse/sync';
import { BOOK_STATUSES } from './constants';
import { NormalizedCsvRow } from './types';

export interface AudibleCsvOptions {
  source?: string;
}

interface AudibleCsvRecord {
  Title?: string;
  'Author(s)'?: string;
  Author?: string;
  ASIN?: string;
  'Product ID'?: string;
  'Purchase Date'?: string;
  'Listening Status'?: string;
}

function toBookStatus(statusRaw?: string) {
  const normalized = (statusRaw ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'listening':
    case 'in progress':
      return BOOK_STATUSES.IN_PROGRESS;
    case 'finished':
    case 'completed':
      return BOOK_STATUSES.FINISHED;
    case 'not started':
    case 'unstarted':
      return BOOK_STATUSES.NOT_STARTED;
    case 'la poubelle':
    case 'dnf':
      return BOOK_STATUSES.LA_POUBELLE;
    default:
      return BOOK_STATUSES.NOT_STARTED;
  }
}

function pick<T>(record: T, keys: Array<keyof T>): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export function parseAudibleCsv(csvContents: string, options: AudibleCsvOptions = {}): NormalizedCsvRow[] {
  const records = parse(csvContents, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as AudibleCsvRecord[];

  const source = options.source ?? 'Audible';

  const seenAsins = new Set<string>();

  return records
    .map((record) => {
      const asin = pick(record, ['ASIN', 'Product ID']);
      if (!asin) return undefined;

      const title = pick(record, ['Title']);
      const author = pick(record, ['Author(s)', 'Author']);
      if (!title || !author) return undefined;

      if (seenAsins.has(asin)) {
        // Prefer the first occurrence to keep deterministic output.
        return undefined;
      }
      seenAsins.add(asin);

      const purchasedAt = pick(record, ['Purchase Date']);
      const status = toBookStatus(record['Listening Status']);

      const normalized: NormalizedCsvRow = {
        title,
        author,
        asin,
        purchasedAt: purchasedAt ?? '',
        statusDefault: status,
        source
      };

      return normalized;
    })
    .filter((row): row is NormalizedCsvRow => Boolean(row));
}

export async function parseAudibleCsvFile(path: string, options: AudibleCsvOptions = {}): Promise<NormalizedCsvRow[]> {
  const contents = await fs.readFile(path, 'utf8');
  return parseAudibleCsv(contents, options);
}
