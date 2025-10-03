import { describe, expect, test } from 'vitest';
import { describeBookImportWorkflow } from '@shared';

describe('Book import workflow (smoke)', () => {
  test('follows the expected step order', () => {
    const summary = describeBookImportWorkflow();
    expect(summary.startAt).toBe('LookupSeriesMetadata');
    expect(summary.steps).toEqual([
      'LookupSeriesMetadata',
      'UpsertSeries',
      'UpsertBook',
      'CascadeIfNeeded'
    ]);
  });
});
