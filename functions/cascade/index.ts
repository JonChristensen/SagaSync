import { BOOK_STATUSES, CascadeIfNeededInput, CascadeIfNeededOutput, DynamoGateway, loadConfig, logInfo } from '@shared';

export async function handler(event: CascadeIfNeededInput): Promise<CascadeIfNeededOutput> {
  logInfo('CascadeIfNeeded invoked (stub)', { cascadeInput: event });
  const config = loadConfig();
  const dynamo = new DynamoGateway(config.seriesTableName, config.booksTableName);
  // TODO: Query DynamoDB + Notion to determine if La Poubelle cascade must run; skip redundant PATCHes.
  void dynamo;
  const finalStatus = event.status === BOOK_STATUSES.LA_POUBELLE ? BOOK_STATUSES.LA_POUBELLE : BOOK_STATUSES.NOT_STARTED;
  return {
    updatedBookCount: 0,
    seriesFinalStatus: finalStatus
  };
}
