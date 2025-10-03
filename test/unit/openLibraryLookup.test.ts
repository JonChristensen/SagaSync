import { describe, expect, test } from 'vitest';
import { lookupSeriesMetadata, SAMPLE_LIBRARY } from '@shared';

describe('lookupSeriesMetadata', () => {
  test('maps Lord of the Rings titles to the expected series name', async () => {
    const result = await lookupSeriesMetadata(SAMPLE_LIBRARY[0]);
    expect(result.seriesName).toBe('The Lord of the Rings');
    expect(result.seriesKey).toBe('j. r. r. tolkien|the lord of the rings');
  });

  test('maps Harry Potter titles via title or author heuristics', async () => {
    const result = await lookupSeriesMetadata(SAMPLE_LIBRARY[2]);
    expect(result.seriesName).toBe('Harry Potter');
    expect(result.seriesKey).toBe('j. k. rowling|harry potter');
  });
});
