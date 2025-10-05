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
import { parseWebhookPayload } from '../common/parseWebhookPayload';
import type { BookStatus } from '@shared';

type WebhookEvent = { asin?: string; status?: string; body?: string };

function normalizeStatus(rawStatus?: string): BookStatus | undefined {
  if (!rawStatus) return undefined;
  const normalized = rawStatus.trim().toLowerCase();

  for (const status of Object.values(BOOK_STATUSES)) {
    if (status.toLowerCase() === normalized) {
      return status;
    }
  }

  if (normalized === 'dnf') {
    return BOOK_STATUSES.LA_POUBELLE;
  }

  return undefined;
}

export async function handler(event: WebhookEvent): Promise<{ statusCode: number; body: string }> {
  const { asin, status } = parseWebhookPayload(event);
  const resolvedAsin = asin?.trim();
  const normalizedStatus = normalizeStatus(status);

  if (!resolvedAsin) {
    logError('WebhookFinished missing ASIN', { event });
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Missing ASIN' })
    };
  }

  const targetStatus = normalizedStatus ?? BOOK_STATUSES.FINISHED;
  logInfo('WebhookFinished received', { asin: resolvedAsin, targetStatus, rawStatus: status });

  const config = loadConfig();
  const dynamo = new DynamoGateway(config.seriesTableName, config.booksTableName);
  const book = await dynamo.getBook(resolvedAsin);

  if (!book) {
    logError('WebhookFinished book not found', { asin });
    return {
      statusCode: 202,
      body: JSON.stringify({ ok: true, cascade: false })
    };
  }

  if (book.status === targetStatus) {
    await cascadeHandler({
      asin: resolvedAsin,
      seriesKey: book.seriesKey,
      status: targetStatus
    });

    return {
      statusCode: 202,
      body: JSON.stringify({ ok: true, cascade: true })
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
    asin: resolvedAsin,
    seriesKey: book.seriesKey,
    status: targetStatus
  });

  return {
    statusCode: 202,
    body: JSON.stringify({ ok: true, cascade: true })
  };
}
