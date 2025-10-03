import { lookupSeriesMetadata, OpenLibraryLookupOutput, StepFunctionInput, logError, logInfo } from '@shared';

export async function handler(event: StepFunctionInput): Promise<OpenLibraryLookupOutput> {
  const row = event.item;
  if (!row) {
    logError('LookupSeriesMetadata missing item payload', { event });
    throw new Error('LookupSeriesMetadata requires an item payload');
  }

  logInfo('LookupSeriesMetadata invoked', { asin: row.asin });
  // TODO: call Open Library API and merge response before returning.
  return lookupSeriesMetadata(row);
}
