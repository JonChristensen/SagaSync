export const BOOK_IMPORT_STEPS = [
  'LookupSeriesMetadata',
  'UpsertSeries',
  'UpsertBook',
  'CascadeIfNeeded'
] as const;

export type BookImportStepName = (typeof BOOK_IMPORT_STEPS)[number];

export interface BookImportWorkflowSummary {
  startAt: BookImportStepName;
  steps: BookImportStepName[];
}

export function describeBookImportWorkflow(): BookImportWorkflowSummary {
  return {
    startAt: BOOK_IMPORT_STEPS[0],
    steps: [...BOOK_IMPORT_STEPS]
  };
}
