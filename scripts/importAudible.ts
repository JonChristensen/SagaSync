import 'dotenv/config';
import { BOOK_STATUSES, NormalizedCsvRow, parseAudibleCsvFile } from '@shared';
import { fetch } from 'undici';
import fs from 'fs/promises';
import path from 'path';

interface CliOptions {
  filePath: string;
  apiUrl?: string;
  dryRun: boolean;
  chunkSize: number;
  chunkDelayMs: number;
}

function parseArgs(argv: string[]): CliOptions {
  const [, , ...rest] = argv;
  if (rest.length === 0) {
    throw new Error('Usage: npm run import:audible -- <path-to-audible-export.csv> [--api-url <https://...>] [--commit]');
  }

  let filePath = '';
  let apiUrl: string | undefined;
  let dryRun = true;
  let chunkSize = 50;
  let chunkDelayMs = 2000;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg) continue;

    if (!filePath && !arg.startsWith('--')) {
      filePath = arg;
      continue;
    }

    if (arg === '--api-url') {
      apiUrl = rest[i + 1];
      i += 1;
      continue;
    }

    if (arg === '--commit') {
      dryRun = false;
      continue;
    }

    if (arg === '--chunk-size') {
      const next = rest[i + 1];
      const parsed = next ? Number.parseInt(next, 10) : Number.NaN;
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --chunk-size value: ${next}`);
      }
      chunkSize = parsed;
      i += 1;
      continue;
    }

    if (arg === '--chunk-delay-ms') {
      const next = rest[i + 1];
      const parsed = next ? Number.parseInt(next, 10) : Number.NaN;
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Invalid --chunk-delay-ms value: ${next}`);
      }
      chunkDelayMs = parsed;
      i += 1;
      continue;
    }
  }

  if (!filePath) {
    throw new Error('Missing path to Audible CSV export');
  }

  return {
    filePath,
    apiUrl,
    dryRun,
    chunkSize,
    chunkDelayMs
  };
}

async function postToApi(apiUrl: string, body: unknown) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Import API responded with ${response.status} ${response.statusText}: ${text}`);
  }

  return response.json();
}

interface SeriesCatalogVolume {
  asin: string;
  title: string;
  sequence: string | null;
  owned: boolean;
}

interface SeriesCatalogEntry {
  parentAsin: string;
  title: string;
  volumes: SeriesCatalogVolume[];
}

interface SeriesCatalogPayload {
  series: SeriesCatalogEntry[];
}

function extractTimestampFromFilename(filePath: string): string | null {
  const base = path.basename(filePath, path.extname(filePath));
  const match = base.match(/audible-library-(.+)$/);
  return match ? match[1] : null;
}

async function loadSeriesCatalog(csvPath: string): Promise<SeriesCatalogPayload | null> {
  const timestamp = extractTimestampFromFilename(csvPath);
  if (!timestamp) return null;

  const jsonName = `audible-series-metadata-${timestamp}.json`;
  const jsonPath = path.join(path.dirname(csvPath), jsonName);

  try {
    const contents = await fs.readFile(jsonPath, 'utf8');
    return JSON.parse(contents) as SeriesCatalogPayload;
  } catch (error) {
    console.warn(`Series metadata file ${jsonName} missing or unreadable: ${String(error)}`);
    return null;
  }
}

function toNumericSequence(raw: string | null): number | null {
  if (!raw) return null;
  const match = raw.match(/^-?\d+(?:\.\d+)?$/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  return Number.isNaN(value) ? null : value;
}

async function appendSyntheticSeriesVolumes(rows: NormalizedCsvRow[], csvPath: string): Promise<NormalizedCsvRow[]> {
  const catalog = await loadSeriesCatalog(csvPath);
  if (!catalog?.series?.length) {
    return rows;
  }

  const libraryAsins = new Set(rows.map((row) => row.asin));
  const augmented = [...rows];

  for (const seriesEntry of catalog.series) {
    const parentAsin = seriesEntry.parentAsin?.trim();
    const seriesName = seriesEntry.title?.trim();
    if (!parentAsin || !seriesEntry.volumes) continue;

    const templateRow = rows.find((row) => row.seriesParentAsin === parentAsin) ?? rows.find((row) => row.seriesNameHint === seriesName);

    for (const volume of seriesEntry.volumes) {
      const asin = (volume.asin || '').trim();
      if (!asin || volume.owned || libraryAsins.has(asin)) continue;

      const title = volume.title?.trim() || 'Unknown Title';
      const author = templateRow?.author ?? 'Unknown';
      augmented.push({
        title,
        author,
        asin,
        purchasedAt: '',
        statusDefault: BOOK_STATUSES.NOT_STARTED,
        source: 'AudibleSeries',
        seriesNameHint: seriesName || title,
        seriesSequenceHint: toNumericSequence(volume.sequence),
        seriesParentAsin: parentAsin,
        ownedHint: false
      });
    }
  }

  return augmented;
}

async function main() {
  const options = parseArgs(process.argv);
  const rows = await parseAudibleCsvFile(options.filePath);
  console.log(`Parsed ${rows.length} items from ${options.filePath}`);

  const enrichedRows = await appendSyntheticSeriesVolumes(rows, options.filePath);
  console.log(`Prepared ${enrichedRows.length} items for import payload`);

  if (enrichedRows.length === 0) {
    console.warn('No rows were parsed; exiting.');
    return;
  }

  if (options.dryRun) {
    console.log('Dry run mode (default). First item preview:');
    console.log(JSON.stringify(rows[0], null, 2));
    console.log('Pass --commit to submit the payload.');
    return;
  }

  if (!options.apiUrl) {
    throw new Error('Missing --api-url while running in commit mode.');
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const executions: string[] = [];
  for (let i = 0; i < enrichedRows.length; i += options.chunkSize) {
    const chunk = enrichedRows.slice(i, i + options.chunkSize);
    const payload = { items: chunk };
    console.log(`Submitting items ${i + 1}-${i + chunk.length} of ${enrichedRows.length}`);
    const result = await postToApi(options.apiUrl, payload);
    const execs = (result as { stateMachineExecutions?: string[] }).stateMachineExecutions ?? [];
    executions.push(...execs);

    const hasMore = i + options.chunkSize < enrichedRows.length;
    if (hasMore && options.chunkDelayMs > 0) {
      console.log(`Waiting ${options.chunkDelayMs}ms before next batch to ease downstream rate limits...`);
      await sleep(options.chunkDelayMs);
    }
  }
  console.log('Import API executions:', JSON.stringify(executions, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
