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

function extractAsin(event: WebhookEvent): string | undefined {
  if (event.asin) return event.asin;
  if (event.body) {
    try {
      const parsed = JSON.parse(event.body) as { asin?: string };
      return parsed.asin;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function handler(event: WebhookEvent): Promise<{ statusCode: number; body: string }> {
  const asin = extractAsin(event)?.trim();

  if (!asin) {
    logError('WebhookStarted missing ASIN', { event });
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Missing ASIN' })
    };
  }

  const targetStatus = BOOK_STATUSES.IN_PROGRESS;
  logInfo('WebhookStarted received', { asin, targetStatus });

  const config = loadConfig();
  const dynamo = new DynamoGateway(config.seriesTableName, config.booksTableName);
  const book = await dynamo.getBook(asin);

  if (!book) {
    logError('WebhookStarted book not found', { asin });
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
