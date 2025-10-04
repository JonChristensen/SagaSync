import {
  BOOK_STATUSES,
  BookDynamoRecord,
  DynamoGateway,
  NotionGateway,
  SeriesVolume,
  UpsertBookInput,
  UpsertBookOutput,
  buildBookCreatePayload,
  buildBookQueryPayload,
  buildBookPatchPayload,
  buildBookStatusPatch,
  buildOwnedFlagPatch,
  getSecretValue,
  loadConfig,
  logError,
  logInfo,
  lookupSeriesVolumes
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
    source: event.source,
    owned: true
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
    owned: true
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

  await ensureSeriesCompleteness({
    seriesKey: event.seriesKey,
    seriesName: event.seriesName,
    seriesId: event.seriesId,
    dynamo,
    notion,
    booksDatabaseId: config.notionBooksDatabaseId
  });

  return {
    asin,
    bookId: notionPageId,
    status,
    seriesId: event.seriesId
  };
}

function slugify(input: string, maxLength = 40): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
}

function buildVirtualAsin(seriesKey: string, volume: SeriesVolume): string {
  const base = slugify(seriesKey);
  const titleSlug = slugify(volume.title);
  const orderPart = volume.order !== null ? `-${volume.order}` : '';
  return `virtual:${base}${orderPart}-${titleSlug}`;
}

async function ensureSeriesCompleteness(params: {
  seriesKey: string;
  seriesName: string;
  seriesId?: string;
  dynamo: DynamoGateway;
  notion: NotionGateway;
  booksDatabaseId: string;
}): Promise<void> {
  const { seriesKey, seriesName, seriesId, dynamo, notion, booksDatabaseId } = params;

  if (!seriesId) return;

  const volumes = await lookupSeriesVolumes(seriesName);
  if (volumes.length === 0) return;

  const existingBooks = await dynamo.listBooksBySeries(seriesKey);
  const existingByKey = new Map<string, BookDynamoRecord>();

  const matchKey = (title: string, order: number | null) => `${order ?? 'x'}|${title.toLowerCase()}`;

  for (const book of existingBooks) {
    existingByKey.set(matchKey(book.title, book.seriesOrder ?? null), book);
  }

  let created = 0;

  for (const volume of volumes) {
    const key = matchKey(volume.title, volume.order);
    if (existingByKey.has(key)) continue;

    const virtualAsin = buildVirtualAsin(seriesKey, volume);
    const existingVirtual = existingBooks.find((book) => book.asin === virtualAsin);

    const baseRecord: BookDynamoRecord = existingVirtual ?? {
      asin: virtualAsin,
      title: volume.title,
      author: volume.author ?? 'Unknown',
      seriesKey,
      status: BOOK_STATUSES.NOT_STARTED,
      seriesOrder: volume.order,
      purchasedAt: '',
      updatedAt: Date.now(),
      owned: false
    };

    let notionPageId = baseRecord.notionPageId;

    if (!notionPageId) {
      try {
        const notionPage = await notion.createPage(
          buildBookCreatePayload(booksDatabaseId, {
            title: baseRecord.title,
            asin: baseRecord.asin,
            status: baseRecord.status,
            seriesPageId: seriesId,
            seriesOrder: baseRecord.seriesOrder ?? null,
            purchasedAt: '',
            source: 'Open Library',
            owned: false
          })
        );
        notionPageId = notionPage.id;
      } catch (error) {
        logError('Failed to create Notion page for synthetic series volume', {
          error,
          asin: baseRecord.asin
        });
        continue;
      }
    } else {
      try {
        await notion.updatePage(notionPageId, {
          ...buildBookStatusPatch(baseRecord.status),
          ...buildOwnedFlagPatch(false),
          archived: false
        });
      } catch (error) {
        logError('Failed to refresh Notion synthetic volume', {
          error,
          asin: baseRecord.asin
        });
      }
    }

    await dynamo.putBook({
      ...baseRecord,
      notionPageId,
      owned: false,
      updatedAt: Date.now()
    });

    existingByKey.set(key, baseRecord);
    created += 1;
  }

  if (created > 0) {
    logInfo('Synthetic series volumes created', { seriesKey, created });
  }
}
