import { describe, expect, test } from 'vitest';
import { handler as upsertSeries } from '@functions/upsertSeries';

const input = {
  seriesKey: 'j. r. r. tolkien|the lord of the rings',
  seriesName: 'The Lord of the Rings'
};

describe('upsertSeries handler (scaffold)', () => {
  test.skip('persists series record and reuses existing entries', async () => {
    const result = await upsertSeries(input);
    expect(result.seriesKey).toBe(input.seriesKey);
    expect(result.seriesId).toBeTruthy();
  });
});
