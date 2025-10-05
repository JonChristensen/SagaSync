import {
  BOOK_STATUSES,
  BOOK_STATUS_PRIORITY,
  BookDynamoRecord,
  DynamoGateway,
  NotionGateway,
  UpsertBookInput,
  UpsertBookOutput,
  buildBookCreatePayload,
  buildBookQueryPayload,
  buildBookPatchPayload,
  getSecretValue,
  loadConfig,
  logError,
  logInfo
} from '@shared';
import type { BookStatus } from '@shared';

function pickStatus(current: BookStatus | undefined, next: BookStatus | undefined): BookStatus {
  if (!current) {
    return next ?? BOOK_STATUSES.NOT_STARTED;
  }

  if (!next) {
    return current;
  }

  const currentRank = BOOK_STATUS_PRIORITY[current] ?? -1;
  const nextRank = BOOK_STATUS_PRIORITY[next] ?? -1;

  if (nextRank > currentRank) {
    return next;
  }

  return current;
}

function isConditionalCheckFailed(error: unknown): boolean {
  return (error as { name?: string } | undefined)?.name === 'ConditionalCheckFailedException';
}

export async function handler(event: UpsertBookInput): Promise<UpsertBookOutput> {
  const asin = event.asin?.trim();
  if (!asin) {
    logError('UpsertBook missing ASIN', { event });
    throw new Error('UpsertBook requires an ASIN');
  }

  logInfo('UpsertBook invoked', { asin, seriesId: event.seriesId });
  const config = loadConfig();
  const dynamo = new DynamoGateway(config.seriesTableName, config.booksTableName);
  const existing = await dynamo.getBook(asin);
  const status = pickStatus(existing?.status, event.statusDefault);
  const shouldTreatAsSeries = Boolean(event.seriesMatch || existing?.seriesMatch);
  const owned = event.ownedHint ?? existing?.owned ?? true;

  const token = await getSecretValue(config.notionTokenSecretName);
  const notion = new NotionGateway(token);

  let notionPageId = existing?.notionPageId;

  if (!notionPageId) {
    const query = await notion.queryDatabase(config.notionBooksDatabaseId, buildBookQueryPayload(asin));
    const existingPage = query.results[0];
    notionPageId = existingPage?.id;
  }

  const bookProps = {
    title: event.title,
    asin,
    status,
    seriesPageId: shouldTreatAsSeries ? event.seriesId : undefined,
    seriesOrder: event.seriesPos ?? null,
    purchasedAt: event.purchasedAt,
    source: event.source,
    owned
  };

  if (!notionPageId) {
    const created = await notion.createPage(buildBookCreatePayload(config.notionBooksDatabaseId, bookProps));
    notionPageId = created.id;
  } else {
    const patchPayload = buildBookPatchPayload(bookProps);
    await notion.updatePage(notionPageId, { ...patchPayload, archived: false });
  }

  if (!notionPageId) {
    logError('Failed to resolve Notion page ID for book', { asin });
    throw new Error('Unable to determine Notion book page');
  }

  const record: BookDynamoRecord = {
    asin,
    title: event.title,
    author: event.author,
    seriesKey: event.seriesKey,
    status,
    notionPageId,
    seriesOrder: event.seriesPos ?? null,
    purchasedAt: event.purchasedAt,
    updatedAt: Date.now(),
    owned,
    seriesMatch: shouldTreatAsSeries
  };

  try {
    await dynamo.putBook(record);
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      const latest = await dynamo.getBook(asin);
      if (latest?.notionPageId) {
        return {
          asin,
          bookId: latest.notionPageId,
          status: latest.status,
          seriesId: shouldTreatAsSeries ? event.seriesId : undefined,
          seriesMatch: latest.seriesMatch !== false
        };
      }
    }
    throw error;
  }

  return {
    asin,
    bookId: notionPageId,
    status,
    seriesId: shouldTreatAsSeries ? event.seriesId : undefined,
    seriesMatch: shouldTreatAsSeries
  };
}
