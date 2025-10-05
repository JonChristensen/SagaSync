import { lookupSeriesMetadata, SeriesMetadataResult, StepFunctionInput, logError, logInfo } from '@shared';

export async function handler(event: StepFunctionInput): Promise<SeriesMetadataResult> {
  const row = event.item;
  if (!row) {
    logError('LookupSeriesMetadata missing item payload', { event });
    throw new Error('LookupSeriesMetadata requires an item payload');
  }

  logInfo('LookupSeriesMetadata invoked', { asin: row.asin });
  return lookupSeriesMetadata(row);
}
