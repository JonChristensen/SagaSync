import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOK_STATUSES, SeriesMetadataResult } from '@shared';
import { handler as upsertBook } from '@functions/upsertBook';
import { handler as upsertSeries } from '@functions/upsertSeries';

const mocks = vi.hoisted(() => {
  const loadConfigMock = vi.fn();
  const getSecretValueMock = vi.fn();
  const getBookMock = vi.fn();
  const putBookMock = vi.fn();
  const getSeriesMock = vi.fn();
  const putSeriesMock = vi.fn();
  const listBooksBySeriesMock = vi.fn();
  const queryDatabaseMock = vi.fn();
  const createPageMock = vi.fn();
  const updatePageMock = vi.fn();
  const buildBookQueryPayloadMock = vi.fn((asin: string) => ({ asin }));
  const buildBookCreatePayloadMock = vi.fn((db: string, props: unknown) => ({ db, props }));
  const buildBookPatchPayloadMock = vi.fn((props: unknown) => ({ props }));
  const buildSeriesQueryPayloadMock = vi.fn((seriesKey: string) => ({ seriesKey }));
  const buildSeriesCreatePayloadMock = vi.fn((db: string, name: string, key: string) => ({ db, name, key }));
  const logInfoMock = vi.fn();
  const logErrorMock = vi.fn();

  return {
    loadConfigMock,
    getSecretValueMock,
    getBookMock,
    putBookMock,
    getSeriesMock,
    putSeriesMock,
    listBooksBySeriesMock,
    queryDatabaseMock,
    createPageMock,
    updatePageMock,
    buildBookQueryPayloadMock,
    buildBookCreatePayloadMock,
    buildBookPatchPayloadMock,
    buildSeriesQueryPayloadMock,
    buildSeriesCreatePayloadMock,
    logInfoMock,
    logErrorMock
  };
});

vi.mock('@shared', () => {
  const BOOK_STATUSES = {
    NOT_STARTED: 'Not started',
    IN_PROGRESS: 'In progress',
    FINISHED: 'Finished',
    LA_POUBELLE: 'La Poubelle'
  } as const;
  const BOOK_STATUS_PRIORITY = {
    [BOOK_STATUSES.NOT_STARTED]: 0,
    [BOOK_STATUSES.IN_PROGRESS]: 1,
    [BOOK_STATUSES.FINISHED]: 2,
    [BOOK_STATUSES.LA_POUBELLE]: 3
  } as const;

  class MockDynamoGateway {
    getBook = mocks.getBookMock;
    putBook = mocks.putBookMock;
    getSeries = mocks.getSeriesMock;
    putSeries = mocks.putSeriesMock;
    listBooksBySeries = mocks.listBooksBySeriesMock;
  }

  class MockNotionGateway {
    queryDatabase = mocks.queryDatabaseMock;
    createPage = mocks.createPageMock;
    updatePage = mocks.updatePageMock;
  }

  return {
    BOOK_STATUSES,
    loadConfig: mocks.loadConfigMock,
    getSecretValue: mocks.getSecretValueMock,
    DynamoGateway: MockDynamoGateway,
    NotionGateway: MockNotionGateway,
    buildBookQueryPayload: mocks.buildBookQueryPayloadMock,
    buildBookCreatePayload: mocks.buildBookCreatePayloadMock,
    buildBookPatchPayload: mocks.buildBookPatchPayloadMock,
    buildSeriesQueryPayload: mocks.buildSeriesQueryPayloadMock,
    buildSeriesCreatePayload: mocks.buildSeriesCreatePayloadMock,
    logInfo: mocks.logInfoMock,
    logError: mocks.logErrorMock,
    BOOK_STATUS_PRIORITY
  };
});

describe('UpsertBook handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigMock.mockReturnValue({
      notionTokenSecretName: 'notion/internal-token',
      notionSeriesDatabaseId: 'series-db',
      notionBooksDatabaseId: 'books-db',
      seriesTableName: 'series-table',
      booksTableName: 'books-table'
    });
    mocks.getSecretValueMock.mockResolvedValue('notion-token');
    mocks.queryDatabaseMock.mockResolvedValue({ results: [] });
    mocks.createPageMock.mockResolvedValue({ id: 'new-notion-id' });
    mocks.updatePageMock.mockResolvedValue({ id: 'updated-notion-id' });
    mocks.getBookMock.mockResolvedValue(null);
    mocks.putBookMock.mockResolvedValue(undefined);
    mocks.listBooksBySeriesMock.mockResolvedValue([]);
  });

  it('trims the ASIN before persisting or calling downstream services', async () => {
    const result = await upsertBook({
      title: 'The Fellowship of the Ring',
      author: 'J. R. R. Tolkien',
      asin: '  LOTR1-TEST  ',
      purchasedAt: '2025-08-15',
      statusDefault: BOOK_STATUSES.NOT_STARTED,
      source: 'Audible',
      seriesKey: 'tolkien|lotr',
      seriesName: 'The Lord of the Rings',
      seriesId: 'series-id',
      seriesPos: 1,
      seriesMatch: true
    });

    expect(mocks.getBookMock).toHaveBeenCalledWith('LOTR1-TEST');
    expect(mocks.buildBookQueryPayloadMock).toHaveBeenCalledWith('LOTR1-TEST');
    expect(mocks.buildBookCreatePayloadMock).toHaveBeenCalledWith('books-db', expect.objectContaining({ asin: 'LOTR1-TEST', owned: true }));
    expect(mocks.putBookMock).toHaveBeenCalledWith(expect.objectContaining({ asin: 'LOTR1-TEST', owned: true }));
    expect(result.asin).toBe('LOTR1-TEST');
    expect(result.bookId).toBe('new-notion-id');
  });

  it('reuses an existing Notion page and skips creation', async () => {
    mocks.getBookMock.mockResolvedValueOnce({
      asin: 'LOTR1-TEST',
      title: 'The Fellowship of the Ring',
      author: 'J. R. R. Tolkien',
      seriesKey: 'tolkien|lotr',
      status: BOOK_STATUSES.IN_PROGRESS,
      notionPageId: 'existing-page',
      updatedAt: 123,
      owned: true
    });

    const result = await upsertBook({
      title: 'The Fellowship of the Ring',
      author: 'J. R. R. Tolkien',
      asin: 'LOTR1-TEST',
      purchasedAt: '2025-08-15',
      statusDefault: BOOK_STATUSES.NOT_STARTED,
      source: 'Audible',
      seriesKey: 'tolkien|lotr',
      seriesName: 'The Lord of the Rings',
      seriesId: 'series-id',
      seriesPos: 1,
      seriesMatch: true
    });

    expect(mocks.queryDatabaseMock).not.toHaveBeenCalled();
    expect(mocks.createPageMock).not.toHaveBeenCalled();
    expect(mocks.updatePageMock).toHaveBeenCalledWith(
      'existing-page',
      expect.objectContaining({ archived: false })
    );
    expect(result.bookId).toBe('existing-page');
    expect(result.status).toBe(BOOK_STATUSES.IN_PROGRESS);
  });

  it('promotes the status when the import reports further progress', async () => {
    mocks.getBookMock.mockResolvedValueOnce({
      asin: 'LOTR1-TEST',
      title: 'The Fellowship of the Ring',
      author: 'J. R. R. Tolkien',
      seriesKey: 'tolkien|lotr',
      status: BOOK_STATUSES.NOT_STARTED,
      notionPageId: 'existing-page',
      updatedAt: 123,
      owned: true
    });

    const result = await upsertBook({
      title: 'The Fellowship of the Ring',
      author: 'J. R. R. Tolkien',
      asin: 'LOTR1-TEST',
      purchasedAt: '2025-08-15',
      statusDefault: BOOK_STATUSES.FINISHED,
      source: 'Audible',
      seriesKey: 'tolkien|lotr',
      seriesName: 'The Lord of the Rings',
      seriesId: 'series-id',
      seriesPos: 1,
      seriesMatch: true
    });

    expect(result.status).toBe(BOOK_STATUSES.FINISHED);
    expect(mocks.buildBookPatchPayloadMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: BOOK_STATUSES.FINISHED })
    );
    expect(mocks.putBookMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: BOOK_STATUSES.FINISHED })
    );
  });

  it('retains the more advanced existing status if the import regresses', async () => {
    mocks.getBookMock.mockResolvedValueOnce({
      asin: 'LOTR1-TEST',
      title: 'The Fellowship of the Ring',
      author: 'J. R. R. Tolkien',
      seriesKey: 'tolkien|lotr',
      status: BOOK_STATUSES.FINISHED,
      notionPageId: 'existing-page',
      updatedAt: 123,
      owned: true
    });

    const result = await upsertBook({
      title: 'The Fellowship of the Ring',
      author: 'J. R. R. Tolkien',
      asin: 'LOTR1-TEST',
      purchasedAt: '2025-08-15',
      statusDefault: BOOK_STATUSES.NOT_STARTED,
      source: 'Audible',
      seriesKey: 'tolkien|lotr',
      seriesName: 'The Lord of the Rings',
      seriesId: 'series-id',
      seriesPos: 1,
      seriesMatch: true
    });

    expect(result.status).toBe(BOOK_STATUSES.FINISHED);
    expect(mocks.buildBookPatchPayloadMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: BOOK_STATUSES.FINISHED })
    );
    expect(mocks.putBookMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: BOOK_STATUSES.FINISHED })
    );
  });

  it('unarchives Notion pages returned from queries before updating', async () => {
    mocks.queryDatabaseMock.mockResolvedValueOnce({
      results: [{ id: 'archived-page', archived: true }]
    });

    const result = await upsertBook({
      title: 'The Two Towers',
      author: 'J. R. R. Tolkien',
      asin: 'LOTR2-TEST',
      purchasedAt: '2025-08-22',
      statusDefault: BOOK_STATUSES.NOT_STARTED,
      source: 'Audible',
      seriesKey: 'tolkien|lotr',
      seriesName: 'The Lord of the Rings',
      seriesId: 'series-id',
      seriesPos: 2,
      seriesMatch: true
    });

    expect(mocks.createPageMock).not.toHaveBeenCalled();
    expect(mocks.updatePageMock).toHaveBeenCalledWith(
      'archived-page',
      expect.objectContaining({ archived: false })
    );
    expect(result.bookId).toBe('archived-page');
  });

});

describe('UpsertSeries handler', () => {
  beforeEach(() => {
    mocks.loadConfigMock.mockReturnValue({
      notionTokenSecretName: 'notion/internal-token',
      notionSeriesDatabaseId: 'series-db',
      notionBooksDatabaseId: 'books-db',
      seriesTableName: 'series-table',
      booksTableName: 'books-table'
    });
    mocks.getSecretValueMock.mockResolvedValue('notion-token');
    mocks.queryDatabaseMock.mockResolvedValue({ results: [] });
    mocks.createPageMock.mockResolvedValue({ id: 'series-notion-id' });
    mocks.getSeriesMock.mockResolvedValue(null);
    mocks.putSeriesMock.mockResolvedValue(undefined);
  });

  it('returns existing series metadata without duplicating writes', async () => {
    mocks.getSeriesMock.mockResolvedValueOnce({
      seriesKey: 'tolkien|lotr',
      seriesName: 'The Lord of the Rings',
      notionPageId: 'existing-series',
      updatedAt: 99
    });

    const input: SeriesMetadataResult = {
      title: 'The Fellowship of the Ring',
      author: 'J. R. R. Tolkien',
      asin: 'LOTR1-TEST',
      purchasedAt: '2025-08-15',
      statusDefault: BOOK_STATUSES.NOT_STARTED,
      source: 'Audible',
      seriesName: 'The Lord of the Rings',
      seriesKey: 'tolkien|lotr',
      seriesPos: 1,
      seriesMatch: true
    };

    const result = await upsertSeries(input);

    expect(mocks.putSeriesMock).not.toHaveBeenCalled();
    expect(result.seriesId).toBe('existing-series');
    expect(result.seriesKey).toBe(input.seriesKey);
    expect(result.asin).toBe(input.asin);
  });

  it('creates a new Notion series page and persists it', async () => {
    const input: SeriesMetadataResult = {
      title: 'The Fellowship of the Ring',
      author: 'J. R. R. Tolkien',
      asin: 'LOTR1-TEST',
      purchasedAt: '2025-08-15',
      statusDefault: BOOK_STATUSES.NOT_STARTED,
      source: 'Audible',
      seriesName: 'The Lord of the Rings',
      seriesKey: 'tolkien|lotr',
      seriesPos: 1,
      seriesMatch: true
    };

    const result = await upsertSeries(input);

    expect(mocks.queryDatabaseMock).toHaveBeenCalledWith('series-db', { seriesKey: 'tolkien|lotr' });
    expect(mocks.createPageMock).toHaveBeenCalledWith({ db: 'series-db', name: 'The Lord of the Rings', key: 'tolkien|lotr' });
    expect(mocks.putSeriesMock).toHaveBeenCalledWith(expect.objectContaining({
      seriesKey: 'tolkien|lotr',
      notionPageId: 'series-notion-id'
    }));
    expect(result.seriesId).toBe('series-notion-id');
  });
});
