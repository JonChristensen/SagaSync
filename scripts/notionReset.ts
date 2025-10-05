#!/usr/bin/env ts-node
import 'dotenv/config';
import { fetch } from 'undici';

interface DatabaseTarget {
  id: string;
  label: string;
}

interface CliOptions {
  dryRun: boolean;
}

interface NotionQueryResponse {
  results: Array<{ id: string; archived?: boolean }>;
  has_more?: boolean;
  next_cursor?: string | null;
}

const NOTION_VERSION = '2022-06-28';

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false };
  const [, , ...rest] = argv;

  for (const arg of rest) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }

  return options;
}

function loadTargets(): DatabaseTarget[] {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error('Missing NOTION_TOKEN environment variable');
  }

  const targets: DatabaseTarget[] = [];
  const booksDb = process.env.NOTION_BOOKS_DB_ID;
  const seriesDb = process.env.NOTION_SERIES_DB_ID;

  if (booksDb) targets.push({ id: booksDb, label: 'Books' });
  if (seriesDb) targets.push({ id: seriesDb, label: 'Series' });

  if (targets.length === 0) {
    throw new Error('No Notion database IDs found. Set NOTION_BOOKS_DB_ID and/or NOTION_SERIES_DB_ID.');
  }

  return targets;
}

async function queryDatabase(databaseId: string, cursor?: string | null): Promise<NotionQueryResponse> {
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to query Notion database ${databaseId}: ${response.status} ${text}`);
  }

  return (await response.json()) as NotionQueryResponse;
}

async function archivePage(pageId: string): Promise<void> {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ archived: true })
    });

    if (response.ok) {
      return;
    }

    if (response.status === 409 || response.status === 429 || (response.status >= 500 && response.status < 600)) {
      const backoffMs = 200 * attempt;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      continue;
    }

    const text = await response.text();
    throw new Error(`Failed to archive page ${pageId}: ${response.status} ${text}`);
  }

  throw new Error(`Failed to archive page ${pageId} after multiple attempts`);
}

async function collectPageIds(target: DatabaseTarget): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null | undefined;
  let hasMore = true;

  while (hasMore) {
    const result = await queryDatabase(target.id, cursor);
    for (const page of result.results) {
      if (!page.archived) {
        ids.push(page.id);
      }
    }
    hasMore = Boolean(result.has_more);
    cursor = result.next_cursor ?? undefined;
  }

  return ids;
}

async function resetDatabase(target: DatabaseTarget, options: CliOptions): Promise<void> {
  console.log(`Scanning Notion ${target.label} database (${target.id})...`);
  const ids = await collectPageIds(target);
  console.log(`Found ${ids.length} active pages in ${target.label}.`);

  if (ids.length === 0) {
    return;
  }

  if (options.dryRun) {
    console.log(`[dry-run] Skipping archival of ${ids.length} pages.`);
    return;
  }

  let archived = 0;
  for (const id of ids) {
    await archivePage(id);
    archived += 1;
    if (archived % 50 === 0) {
      console.log(`Archived ${archived}/${ids.length} pages in ${target.label}...`);
    }
  }

  console.log(`Archived ${archived} pages in ${target.label}.`);
}

async function main() {
  try {
    const options = parseArgs(process.argv);
    const targets = loadTargets();

    for (const target of targets) {
      await resetDatabase(target, options);
    }

    if (options.dryRun) {
      console.log('Dry run complete. Re-run without --dry-run to archive pages.');
    } else {
      console.log('Notion databases reset complete.');
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

void main();
