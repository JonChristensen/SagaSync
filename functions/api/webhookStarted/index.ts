import { BOOK_STATUSES, CascadeIfNeededInput, loadConfig, logInfo } from '@shared';

type WebhookEvent = { asin?: string; status?: string; body?: string };

function parseEvent(event: WebhookEvent): CascadeIfNeededInput {
  if (event.asin && event.status) {
    return { asin: event.asin, status: event.status as typeof BOOK_STATUSES[keyof typeof BOOK_STATUSES] };
  }

  if (event.body) {
    const parsed = JSON.parse(event.body) as { asin: string };
    return { asin: parsed.asin, status: BOOK_STATUSES.IN_PROGRESS };
  }

  return { status: BOOK_STATUSES.IN_PROGRESS };
}

export async function handler(event: WebhookEvent): Promise<{ statusCode: number; body: string }> {
  const cascadeInput = parseEvent(event);
  logInfo('WebhookStarted invoked (stub)', { cascadeInput });
  const config = loadConfig();
  // TODO: Update DynamoDB + Notion to mark the book In progress, avoiding redundant calls.
  void config;
  return {
    statusCode: 202,
    body: JSON.stringify({ ok: true })
  };
}
