import { describe, expect, test } from 'vitest';
import { lookupSeriesMetadata, SAMPLE_LIBRARY } from '@shared';

describe('lookupSeriesMetadata', () => {
  test('uses Audible series hints when present', async () => {
    const result = await lookupSeriesMetadata({
      title: 'Artemis Fowl Movie Tie-In Edition',
      author: 'Eoin Colfer',
      asin: 'B002V8MYYE',
      purchasedAt: '2025-10-01',
      statusDefault: 'Not started',
      source: 'Audible',
      seriesNameHint: 'Artemis Fowl',
      seriesSequenceHint: 1,
      seriesParentAsin: 'B005NAD2U2'
    });

    expect(result.seriesMatch).toBe(true);
    expect(result.seriesName).toBe('Artemis Fowl');
    expect(result.seriesPos).toBe(1);
  });

  test('defaults to treating a book as standalone when no hints exist', async () => {
    const result = await lookupSeriesMetadata(SAMPLE_LIBRARY[3]);
    expect(result.seriesMatch).toBe(false);
    expect(result.seriesName).toBe(SAMPLE_LIBRARY[3].title);
    expect(result.seriesPos).toBeNull();
  });
});
