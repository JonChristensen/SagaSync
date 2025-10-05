#!/usr/bin/env ts-node
import 'dotenv/config';
import { fetch } from 'undici';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, paginateScan } from '@aws-sdk/lib-dynamodb';
import {
  DynamoGateway,
  NotionGateway,
  loadConfig,
  getSecretValue,
  logInfo,
  logError,
  BOOK_STATUS_PRIORITY
} from '@shared';

interface CliOptions {
  dryRun: boolean;
  limit?: number;
}

interface NotionBookPage {
  pageId: string;
  title: string;
  asin: string;
  status: string | null;
  seriesOrder: number | null;
  lastEdited: number;
  seriesRelations: string[];
  hasDynamoRecord: boolean;
}

interface DuplicateGroup {
  key: string;
  title: string;
  seriesRelations: string[];
  pages: NotionBookPage[];
  keeper: NotionBookPage;
  archives: NotionBookPage[];
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: true };
  const [, , ...rest] = argv;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--commit') {
      options.dryRun = false;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--limit') {
      const value = rest[i + 1];
      if (!value) throw new Error('Missing value for --limit');
      options.limit = Number.parseInt(value, 10);
      if (!Number.isFinite(options.limit) || options.limit! <= 0) {
        throw new Error(`Invalid --limit value: ${value}`);
      }
      i += 1;
      continue;
    }
  }

  return options;
}

async function loadDynamoBooks(tableName: string): Promise<Set<string>> {
  const dynamoClient = new DynamoDBClient({});
  const documentClient = DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: { removeUndefinedValues: true }
  });

  const asinSet = new Set<string>();
  const paginator = paginateScan(
    { client: documentClient },
    {
      TableName: tableName,
      ProjectionExpression: 'asin'
    }
  );

  for await (const page of paginator) {
    for (const item of page.Items ?? []) {
      const asin = typeof item.asin === 'string' ? item.asin.trim() : '';
      if (asin) {
        asinSet.add(asin);
      }
    }
  }

  return asinSet;
}

async function fetchNotionBooks(token: string, databaseId: string): Promise<NotionBookPage[]> {
  const pages: NotionBookPage[] = [];
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) {
      body.start_cursor = cursor;
    }

    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to query Notion books database: ${response.status} ${text}`);
    }

    const payload = (await response.json()) as {
      results: Array<Record<string, any>>;
      has_more?: boolean;
      next_cursor?: string | null;
    };

    for (const page of payload.results) {
      const props = page.properties ?? {};
      const titleBlocks = props.Name?.title ?? [];
      const asinBlocks = props.ASIN?.rich_text ?? [];
      const seriesRelation = props.Series?.relation ?? [];
      const seriesOrderValue = props['Series Order']?.number;
      const statusName = props.Status?.status?.name ?? null;

      const title = titleBlocks.map((block: any) => block.plain_text ?? '').join('').trim();
      if (!title) continue;

      const asin = asinBlocks.map((block: any) => block.plain_text ?? '').join('').trim();
      const lastEditedRaw = page.last_edited_time ?? page.created_time ?? 0;
      const lastEdited = typeof lastEditedRaw === 'string' ? Date.parse(lastEditedRaw) : Number(lastEditedRaw ?? 0);

      pages.push({
        pageId: page.id,
        title,
        asin,
        status: statusName,
        seriesOrder: typeof seriesOrderValue === 'number' ? seriesOrderValue : null,
        lastEdited: Number.isFinite(lastEdited) ? lastEdited : 0,
        seriesRelations: seriesRelation.map((rel: any) => rel.id).sort(),
        hasDynamoRecord: false
      });
    }

    cursor = payload.has_more ? payload.next_cursor ?? undefined : undefined;
  } while (cursor);

  return pages;
}

function chooseKeeper(group: NotionBookPage[], dynamoAsins: Set<string>): NotionBookPage {
  let best: NotionBookPage | undefined;

  const score = (page: NotionBookPage): number => {
    let value = 0;
    if (page.asin && dynamoAsins.has(page.asin)) value += 10_000;
    if (page.seriesOrder !== null && page.seriesOrder !== undefined) value += 1_000;
    const statusPriority = page.status && BOOK_STATUS_PRIORITY[page.status as keyof typeof BOOK_STATUS_PRIORITY];
    if (typeof statusPriority === 'number' && Number.isFinite(statusPriority)) {
      value += statusPriority * 100;
    }
    value += Number(page.lastEdited) / 1_000; // preserve ordering by recency
    return value;
  };

  for (const page of group) {
    const currentScore = score(page);
    if (!best || currentScore > score(best)) {
      best = page;
    }
  }

  return best ?? group[0];
}

async function archivePages(notion: NotionGateway, pageIds: string[]): Promise<void> {
  for (const [index, pageId] of pageIds.entries()) {
    try {
      await notion.updatePage(pageId, { properties: {}, archived: true });
      logInfo('Archived duplicate Notion book page', { pageId });
    } catch (error) {
      logError('Failed to archive duplicate Notion book page', { error, pageId });
      throw error;
    }

    if ((index + 1) % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

async function main() {
  const options = parseArgs(process.argv);
  const config = loadConfig();

  const notionToken = await getSecretValue(config.notionTokenSecretName);
  const notion = new NotionGateway(notionToken);

  logInfo('Loading Dynamo ASIN index');
  const dynamoAsins = await loadDynamoBooks(config.booksTableName);

  logInfo('Fetching Notion book pages');
  const pages = await fetchNotionBooks(notionToken, config.notionBooksDatabaseId);

  const byGroupKey = new Map<string, NotionBookPage[]>();
  for (const page of pages) {
    const keyParts = [page.title.trim().toLowerCase()];
    if (page.seriesRelations.length) {
      keyParts.push(page.seriesRelations.join(','));
    }
    const key = keyParts.join('|');
    const existing = byGroupKey.get(key);
    if (existing) {
      existing.push(page);
    } else {
      byGroupKey.set(key, [page]);
    }
  }

  const duplicates: DuplicateGroup[] = [];
  for (const [key, group] of byGroupKey.entries()) {
    if (group.length <= 1) continue;
    const keeper = chooseKeeper(group, dynamoAsins);
    const archives = group.filter((page) => page.pageId !== keeper.pageId);
    duplicates.push({
      key,
      title: group[0].title,
      seriesRelations: group[0].seriesRelations,
      pages: group,
      keeper,
      archives
    });
  }

  duplicates.sort((a, b) => b.pages.length - a.pages.length);

  const limit = options.limit ?? duplicates.length;
  logInfo('Duplicate summary', {
    totalPages: pages.length,
    duplicateGroups: duplicates.length,
    totalArchives: duplicates.reduce((sum, group) => sum + group.archives.length, 0)
  });

  for (const group of duplicates.slice(0, limit)) {
    logInfo('Duplicate group', {
      title: group.title,
      copies: group.pages.length,
      keeper: group.keeper.pageId,
      archives: group.archives.map((page) => page.pageId)
    });
  }

  if (duplicates.length === 0) {
    logInfo('No duplicates detected; exiting');
    return;
  }

  if (options.dryRun) {
    logInfo('Dry run complete. Re-run with --commit to archive duplicates.');
    return;
  }

  logInfo('Archiving duplicate Notion book pages', { groups: duplicates.length });
  const toArchive = duplicates.flatMap((group) => group.archives.map((page) => page.pageId));
  await archivePages(notion, toArchive);
  logInfo('Archival complete', { archived: toArchive.length });
}

main().catch((error) => {
  logError('Failed to deduplicate Notion books', { error });
  process.exitCode = 1;
});
