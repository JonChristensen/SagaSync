import { describe, expect, it } from 'vitest';
import { parseAudibleCsv } from '@shared';
import { BOOK_STATUSES } from '@shared';

const SAMPLE_CSV = `Title,Author(s),Listening Status,Purchase Date,Product ID,Series Title,Series Sequence,Series Parent ASIN
The Fellowship of the Ring,J. R. R. Tolkien,Finished,2025-08-15,LOTR1-TEST,The Lord of the Rings,1,SERIES-LOTR
The Two Towers,J. R. R. Tolkien,Listening,2025-08-22,LOTR2-TEST,The Lord of the Rings,2,SERIES-LOTR
Harry Potter and the Sorcerer's Stone,J. K. Rowling,Not Started,2025-09-01,HP1-TEST,,,
`;

describe('parseAudibleCsv', () => {
  it('parses Audible CSV rows into normalized records', () => {
    const results = parseAudibleCsv(SAMPLE_CSV);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      title: 'The Fellowship of the Ring',
      author: 'J. R. R. Tolkien',
      asin: 'LOTR1-TEST',
      purchasedAt: '2025-08-15',
      statusDefault: BOOK_STATUSES.FINISHED,
      source: 'Audible',
      seriesNameHint: 'The Lord of the Rings',
      seriesSequenceHint: 1,
      seriesParentAsin: 'SERIES-LOTR',
      ownedHint: true
    });
    expect(results[1].statusDefault).toBe(BOOK_STATUSES.IN_PROGRESS);
    expect(results[1].seriesSequenceHint).toBe(2);
    expect(results[2].seriesNameHint).toBeUndefined();
    expect(results.every((row) => row.ownedHint === true)).toBe(true);
    expect(results[2].statusDefault).toBe(BOOK_STATUSES.NOT_STARTED);
  });

  it('deduplicates repeated ASINs, keeping the first occurrence', () => {
    const csv =
      SAMPLE_CSV +
      `Duplicate Title,J. R. R. Tolkien,Not Started,2025-10-01,LOTR1-TEST,The Lord of the Rings,1,SERIES-LOTR\n`;
    const results = parseAudibleCsv(csv);
    expect(results).toHaveLength(3);
    expect(results.some((row) => row.title === 'Duplicate Title')).toBe(false);
  });

  it('skips rows missing required fields', () => {
    const csv =
      'Title,Author(s),Listening Status,Purchase Date,Product ID,Series Title,Series Sequence,Series Parent ASIN\n,Unknown,,2025-10-01,NO-ASIN,,,\n';
    const results = parseAudibleCsv(csv);
    expect(results).toHaveLength(0);
  });

  it('handles legacy CSVs without series columns', () => {
    const legacyCsv = `Title,Author(s),Listening Status,Purchase Date,Product ID\nLegacy Title,Author One,Finished,2024-01-01,LEGACY-1\n`;
    const results = parseAudibleCsv(legacyCsv);
    expect(results).toHaveLength(1);
    expect(results[0].seriesNameHint).toBeUndefined();
  });
});
