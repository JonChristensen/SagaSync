import { BOOK_STATUSES, SyncSeriesFinalStatusInput, SyncSeriesFinalStatusOutput, DynamoGateway, loadConfig, logInfo } from '@shared';

export async function handler(event: SyncSeriesFinalStatusInput): Promise<SyncSeriesFinalStatusOutput> {
  logInfo('SyncSeriesFinalStatus invoked (stub)', { seriesKey: event.seriesKey });
  const config = loadConfig();
  const dynamo = new DynamoGateway(config.seriesTableName, config.booksTableName);
  // TODO: Recompute series final status based on book states and avoid redundant PATCH operations.
  void dynamo;
  return {
    seriesKey: event.seriesKey,
    finalStatus: BOOK_STATUSES.NOT_STARTED,
    changed: false
  };
}
