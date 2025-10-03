export const BOOK_STATUSES = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  FINISHED: 'Finished',
  LA_POUBELLE: 'La Poubelle'
} as const;

export const NOTION_VERSION = '2022-06-28';
export const DEFAULT_TIME_ZONE = 'America/Denver';

export const ENV_VARS = {
  NOTION_TOKEN_SECRET_NAME: 'NOTION_TOKEN_SECRET_NAME',
  NOTION_SERIES_DB_ID: 'NOTION_SERIES_DB_ID',
  NOTION_BOOKS_DB_ID: 'NOTION_BOOKS_DB_ID',
  SERIES_TABLE_NAME: 'SERIES_TABLE_NAME',
  BOOKS_TABLE_NAME: 'BOOKS_TABLE_NAME',
  STATE_MACHINE_ARN: 'STATE_MACHINE_ARN'
} as const;

export const OPEN_LIBRARY_ENDPOINT = 'https://openlibrary.org/search.json';
