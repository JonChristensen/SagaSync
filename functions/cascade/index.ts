import {
  BOOK_STATUSES,
  CascadeIfNeededInput,
  CascadeIfNeededOutput,
  DynamoGateway,
  NotionGateway,
  buildBookStatusPatch,
  buildSeriesFinalStatusPatch,
  getSecretValue,
  loadConfig,
  logError,
  logInfo
} from '@shared';
import type { BookStatus } from '@shared';

function determineSeriesFinalStatus(statuses: BookStatus[]): BookStatus {
  if (statuses.length === 0) {
    return BOOK_STATUSES.NOT_STARTED;
  }

  const allFinished = statuses.every((status) => status === BOOK_STATUSES.FINISHED);
  if (allFinished) {
    return BOOK_STATUSES.FINISHED;
  }

  if (statuses.includes(BOOK_STATUSES.LA_POUBELLE)) {
    return BOOK_STATUSES.LA_POUBELLE;
  }

  if (statuses.some((status) => status === BOOK_STATUSES.IN_PROGRESS)) {
    return BOOK_STATUSES.IN_PROGRESS;
  }

  if (statuses.some((status) => status === BOOK_STATUSES.FINISHED)) {
    return BOOK_STATUSES.IN_PROGRESS;
  }

  return BOOK_STATUSES.NOT_STARTED;
}

export async function handler(event: CascadeIfNeededInput): Promise<CascadeIfNeededOutput> {
  logInfo('CascadeIfNeeded invoked', { cascadeInput: event });

  if (event.seriesMatch === false) {
    logInfo('Cascade skipped: standalone entry', { event });
    return {
      updatedBookCount: 0,
      seriesFinalStatus: event.status
    };
  }

  const config = loadConfig();
  const dynamo = new DynamoGateway(config.seriesTableName, config.booksTableName);

  const targetBook = event.asin ? await dynamo.getBook(event.asin) : null;
  let seriesKey = event.seriesKey ?? targetBook?.seriesKey;

  if (!seriesKey) {
    logInfo('Cascade skipped: no series key derived', { event });
    const fallbackStatus = targetBook?.status ?? event.status ?? BOOK_STATUSES.NOT_STARTED;
    return {
      updatedBookCount: 0,
      seriesFinalStatus: fallbackStatus
    };
  }

  if (targetBook?.seriesMatch === false) {
    logInfo('Cascade skipped: target book marked standalone', { seriesKey, asin: targetBook.asin });
    return {
      updatedBookCount: 0,
      seriesFinalStatus: targetBook.status ?? event.status
    };
  }

  const books = await dynamo.listBooksBySeries(seriesKey);
  const relevantBooks = books.filter((book) => book.seriesMatch !== false);

  if (relevantBooks.length === 0) {
    logInfo('Cascade skipped: no books found for series', { seriesKey });
    return {
      updatedBookCount: 0,
      seriesFinalStatus: BOOK_STATUSES.NOT_STARTED
    };
  }

  const notionToken = await getSecretValue(config.notionTokenSecretName);
  const notion = new NotionGateway(notionToken);
  const seriesRecord = await dynamo.getSeries(seriesKey);

  let updatedBookCount = 0;
  let finalStatus = seriesRecord?.finalStatus ?? BOOK_STATUSES.NOT_STARTED;

  if (event.status === BOOK_STATUSES.LA_POUBELLE) {
    for (const book of relevantBooks) {
      if (book.status === BOOK_STATUSES.FINISHED || book.status === BOOK_STATUSES.LA_POUBELLE) {
        continue;
      }

      const updatedRecord = {
        ...book,
        status: BOOK_STATUSES.LA_POUBELLE,
        updatedAt: Date.now()
      };

      await dynamo.putBook(updatedRecord);
      if (book.notionPageId) {
        try {
          await notion.updatePage(book.notionPageId, {
            ...buildBookStatusPatch(BOOK_STATUSES.LA_POUBELLE),
            archived: false
          });
        } catch (error) {
          logError('Failed to update Notion book during cascade', { error, asin: book.asin });
        }
      }
      updatedBookCount += 1;
    }

    finalStatus = BOOK_STATUSES.LA_POUBELLE;
  } else if (event.status === BOOK_STATUSES.FINISHED) {
    const statuses = relevantBooks.map((book) =>
      event.asin && book.asin === event.asin ? BOOK_STATUSES.FINISHED : book.status
    );
    finalStatus = determineSeriesFinalStatus(statuses);
  } else {
    const statuses = relevantBooks.map((book) =>
      event.asin && book.asin === event.asin && event.status ? event.status : book.status
    );
    finalStatus = determineSeriesFinalStatus(statuses);
  }

  if (seriesRecord?.notionPageId && finalStatus !== seriesRecord.finalStatus) {
    try {
      await notion.updatePage(seriesRecord.notionPageId, {
        ...buildSeriesFinalStatusPatch(finalStatus),
        archived: false
      });
    } catch (error) {
      logError('Failed to update Notion series final status', { error, seriesKey });
      throw error;
    }
  }

  const updatedSeriesRecord = {
    seriesKey,
    seriesName: seriesRecord?.seriesName ?? targetBook?.title ?? 'Unknown Series',
    notionPageId: seriesRecord?.notionPageId,
    finalStatus,
    updatedAt: Date.now()
  };
  await dynamo.putSeries(updatedSeriesRecord);

  return {
    updatedBookCount,
    seriesFinalStatus: finalStatus
  };
}
