import {
  BOOK_STATUSES,
  DynamoGateway,
  NotionGateway,
  buildBookStatusPatch,
  getSecretValue,
  loadConfig,
  logError,
  logInfo
} from '@shared';
import { handler as cascadeHandler } from '@functions/cascade';

type WebhookEvent = { asin?: string; status?: string; body?: string };

function extractDetails(event: WebhookEvent): { asin?: string; status?: string } {
  if (event.asin || event.status) {
    return { asin: event.asin, status: event.status };
  }

  if (event.body) {
    try {
      const parsed = JSON.parse(event.body) as { asin?: string; status?: string };
      return parsed;
    } catch {
      return {};
    }
  }

  return {};
}

export async function handler(event: WebhookEvent): Promise<{ statusCode: number; body: string }> {
  const { asin: rawAsin, status: rawStatus } = extractDetails(event);
  const asin = rawAsin?.trim();

  if (!asin) {
    logError('WebhookFinished missing ASIN', { event });
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Missing ASIN' })
    };
  }

  const targetStatus = (rawStatus as typeof BOOK_STATUSES[keyof typeof BOOK_STATUSES]) ?? BOOK_STATUSES.FINISHED;
  logInfo('WebhookFinished received', { asin, targetStatus });

  const config = loadConfig();
  const dynamo = new DynamoGateway(config.seriesTableName, config.booksTableName);
  const book = await dynamo.getBook(asin);

  if (!book) {
    logError('WebhookFinished book not found', { asin });
    return {
      statusCode: 202,
      body: JSON.stringify({ ok: true, cascade: false })
    };
  }

  if (book.status === targetStatus) {
    return {
      statusCode: 202,
      body: JSON.stringify({ ok: true, cascade: false })
    };
  }

  const notionToken = await getSecretValue(config.notionTokenSecretName);
  const notion = new NotionGateway(notionToken);

  const updatedRecord = {
    ...book,
    status: targetStatus,
    updatedAt: Date.now()
  };

  await dynamo.putBook(updatedRecord);

  if (book.notionPageId) {
    await notion.updatePage(book.notionPageId, {
      ...buildBookStatusPatch(targetStatus),
      archived: false
    });
  }

  await cascadeHandler({
    asin,
    seriesKey: book.seriesKey,
    status: targetStatus
  });

  return {
    statusCode: 202,
    body: JSON.stringify({ ok: true, cascade: true })
  };
}
