import { beforeEach, describe, expect, test, vi } from 'vitest';
import { lookupSeriesMetadata, lookupSeriesVolumes, SAMPLE_LIBRARY } from '@shared';

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

describe('lookupSeriesVolumes', () => {
  test('returns ordered, deduplicated volumes', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        docs: [
          {
            title: 'The Two Towers',
            author_name: ['J. R. R. Tolkien'],
            series: ['The Lord of the Rings (2)']
          },
          {
            title: 'The Return of the King',
            author_name: ['J. R. R. Tolkien'],
            series: ['The Lord of the Rings (3)']
          },
          {
            title: 'The Return of the King',
            author_name: ['J. R. R. Tolkien'],
            series: ['The Lord of the Rings (3)']
          }
        ]
      })
    });

    const volumes = await lookupSeriesVolumes('The Lord of the Rings');
    expect(volumes).toHaveLength(2);
    expect(volumes[0]).toMatchObject({ title: 'The Two Towers', order: 2 });
    expect(volumes[1]).toMatchObject({ title: 'The Return of the King', order: 3 });
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
