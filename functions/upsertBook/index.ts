import {
  BOOK_STATUSES,
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
  const status = existing?.status ?? event.statusDefault ?? BOOK_STATUSES.NOT_STARTED;

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
    seriesPageId: event.seriesId,
    seriesOrder: event.seriesPos ?? null,
    purchasedAt: event.purchasedAt,
    source: event.source
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
    updatedAt: Date.now()
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
          seriesId: event.seriesId
        };
      }
    }
    throw error;
  }

  return {
    asin,
    bookId: notionPageId,
    status,
    seriesId: event.seriesId
  };
}
