import { lookupSeriesMetadata, OpenLibraryLookupInput, OpenLibraryLookupOutput, logInfo } from '@shared';

export async function handler(event: OpenLibraryLookupInput): Promise<OpenLibraryLookupOutput> {
  logInfo('LookupSeriesMetadata invoked (stub)', { asin: event.asin });
  // TODO: call Open Library API and merge response before returning.
  return lookupSeriesMetadata(event);
}
