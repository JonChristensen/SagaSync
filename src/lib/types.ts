export type BookStatus = 'Not started' | 'In progress' | 'Finished' | 'La Poubelle';

export interface NormalizedCsvRow {
  title: string;
  author: string;
  asin: string;
  purchasedAt: string;
  statusDefault: BookStatus;
  source: 'Audible';
}

export interface OpenLibraryLookupInput extends NormalizedCsvRow {}

export interface OpenLibraryDoc {
  title?: string;
  author_name?: string[];
  series?: string[];
}

export interface OpenLibraryResponse {
  docs: OpenLibraryDoc[];
}

export interface OpenLibraryLookupOutput extends NormalizedCsvRow {
  seriesName: string;
  seriesPos: number | null;
  seriesKey: string;
}

export interface UpsertSeriesInput {
  seriesKey: string;
  seriesName: string;
}

export interface UpsertSeriesOutput {
  seriesKey: string;
  seriesId: string;
}

export interface UpsertBookInput extends OpenLibraryLookupOutput {
  seriesId: string;
}

export interface UpsertBookOutput {
  asin: string;
  bookId: string;
  status: BookStatus;
  seriesId: string;
}

export interface CascadeIfNeededInput {
  seriesKey?: string;
  asin?: string;
  status: BookStatus;
}

export interface CascadeIfNeededOutput {
  updatedBookCount: number;
  seriesFinalStatus: BookStatus;
}

export interface SyncSeriesFinalStatusInput {
  seriesKey: string;
}

export interface SyncSeriesFinalStatusOutput {
  seriesKey: string;
  finalStatus: BookStatus;
  changed: boolean;
}

export interface StepFunctionInput {
  item: NormalizedCsvRow;
}

export interface ImportApiPayload {
  items: NormalizedCsvRow[];
}

export interface ImportApiResponse {
  stateMachineExecutions: string[];
}

export interface BookDynamoRecord {
  asin: string;
  title: string;
  author: string;
  seriesKey: string;
  status: BookStatus;
  notionPageId?: string;
  seriesOrder?: number | null;
  purchasedAt?: string;
  updatedAt: number;
  owned?: boolean;
}

export interface SeriesDynamoRecord {
  seriesKey: string;
  seriesName: string;
  finalStatus?: BookStatus;
  notionPageId?: string;
  updatedAt: number;
}

export interface NotionTitleProperty {
  title: Array<{ text: { content: string } }>;
}

export interface NotionRichTextProperty {
  rich_text: Array<{ text: { content: string } }>;
}

export interface NotionStatusProperty {
  status: { name: BookStatus };
}

export interface NotionRelationProperty {
  relation: Array<{ id: string }>;
}

export interface NotionDateProperty {
  date: { start: string } | null;
}

export interface NotionNumberProperty {
  number: number | null;
}

export interface NotionSelectProperty {
  select: { name: string };
}

export type NotionPropertyValue =
  | NotionTitleProperty
  | NotionRichTextProperty
  | NotionStatusProperty
  | NotionRelationProperty
  | NotionDateProperty
  | NotionNumberProperty
  | NotionSelectProperty;

export interface NotionPage {
  id: string;
  properties: Record<string, NotionPropertyValue>;
  archived?: boolean;
}

export interface NotionCreatePagePayload {
  parent: { database_id: string };
  properties: Record<string, NotionPropertyValue>;
}

export interface NotionPatchPagePayload {
  properties: Record<string, NotionPropertyValue>;
  archived?: boolean;
}

export interface NotionQueryPayload {
  filter: unknown;
  page_size?: number;
}

export interface NotionQueryResponse {
  results: NotionPage[];
}

export interface SeriesVolume {
  title: string;
  author?: string;
  order: number | null;
}
