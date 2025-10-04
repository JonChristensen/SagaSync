import { beforeEach, describe, expect, test, vi } from 'vitest';
import { lookupSeriesMetadata, SAMPLE_LIBRARY } from '@shared';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('undici', () => ({
  fetch: fetchMock
}));

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ docs: [] })
  });
});

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

  test('uses Open Library API when results are available', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        docs: [
          {
            series: ['The Lord of the Rings (1)']
          }
        ]
      })
    });

    const result = await lookupSeriesMetadata(SAMPLE_LIBRARY[0]);
    expect(fetchMock).toHaveBeenCalled();
    expect(result.seriesName).toBe('The Lord of the Rings');
    expect(result.seriesPos).toBe(1);
  });
});
