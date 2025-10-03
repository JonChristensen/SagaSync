import { describe, expect, test } from 'vitest';
import { handler as cascadeIfNeeded } from '@functions/cascade';
import { BOOK_STATUSES } from '@shared';

describe('cascadeIfNeeded handler (scaffold)', () => {
  test.skip('trashes siblings when a book enters La Poubelle', async () => {
    const result = await cascadeIfNeeded({
      seriesKey: 'j. r. r. tolkien|the lord of the rings',
      asin: 'LOTR2-TEST',
      status: BOOK_STATUSES.LA_POUBELLE
    });

    expect(result.seriesFinalStatus).toBe(BOOK_STATUSES.LA_POUBELLE);
    expect(result.updatedBookCount).toBeGreaterThan(0);
  });
});
