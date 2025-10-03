import { describe, expect, test } from 'vitest';
import { handler as upsertSeries } from '@functions/upsertSeries';

const input = {
  title: 'The Fellowship of the Ring',
  author: 'J. R. R. Tolkien',
  asin: 'LOTR1-TEST',
  purchasedAt: '2025-08-15',
  statusDefault: 'Not started' as const,
  source: 'Audible' as const,
  seriesKey: 'j. r. r. tolkien|the lord of the rings',
  seriesName: 'The Lord of the Rings',
  seriesPos: 1
};

describe('upsertSeries handler (scaffold)', () => {
  test.skip('persists series record and reuses existing entries', async () => {
    const result = await upsertSeries(input);
    expect(result.seriesKey).toBe(input.seriesKey);
    expect(result.seriesId).toBeTruthy();
  });
});
