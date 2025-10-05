import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handler as cascadeIfNeeded } from '@functions/cascade';
import { BOOK_STATUSES } from '@shared';

const mocks = vi.hoisted(() => {
  const loadConfigMock = vi.fn();
  const getSecretValueMock = vi.fn();
  const getBookMock = vi.fn();
  const putBookMock = vi.fn();
  const getSeriesMock = vi.fn();
  const putSeriesMock = vi.fn();
  const listBooksBySeriesMock = vi.fn();
  const updatePageMock = vi.fn();
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
    updatePageMock,
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

  class MockDynamoGateway {
    constructor(public seriesTableName: string, public booksTableName: string) {
      void seriesTableName;
      void booksTableName;
    }
    getBook = mocks.getBookMock;
    putBook = mocks.putBookMock;
    getSeries = mocks.getSeriesMock;
    putSeries = mocks.putSeriesMock;
    listBooksBySeries = mocks.listBooksBySeriesMock;
  }

  class MockNotionGateway {
    constructor(public token: string) {
      void token;
    }
    updatePage = mocks.updatePageMock;
  }

  return {
    BOOK_STATUSES,
    loadConfig: mocks.loadConfigMock,
    getSecretValue: mocks.getSecretValueMock,
    DynamoGateway: MockDynamoGateway,
    NotionGateway: MockNotionGateway,
    buildBookStatusPatch: (status: string) => ({ properties: { Status: status }, __type: 'book' }),
    buildSeriesFinalStatusPatch: (status: string) => ({ properties: { 'Final Status': status }, __type: 'series' }),
    logInfo: mocks.logInfoMock,
    logError: mocks.logErrorMock
  };
});

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
  mocks.getSeriesMock.mockResolvedValue({
    seriesKey: 'tolkien|lotr',
    seriesName: 'The Lord of the Rings',
    notionPageId: 'series-page',
    finalStatus: BOOK_STATUSES.NOT_STARTED,
    updatedAt: 1
  });
  mocks.updatePageMock.mockResolvedValue(undefined);
  mocks.putSeriesMock.mockResolvedValue(undefined);
  mocks.putBookMock.mockResolvedValue(undefined);
});

describe('cascadeIfNeeded handler', () => {
  it('trashes siblings when a book enters La Poubelle', async () => {
  mocks.getBookMock.mockResolvedValue({
    asin: 'LOTR2-TEST',
    title: 'The Two Towers',
    author: 'J. R. R. Tolkien',
    seriesKey: 'tolkien|lotr',
    status: BOOK_STATUSES.IN_PROGRESS,
    updatedAt: 100,
    owned: true
  });

    mocks.listBooksBySeriesMock.mockResolvedValue([
      {
        asin: 'LOTR1-TEST',
        title: 'The Fellowship of the Ring',
        author: 'J. R. R. Tolkien',
        seriesKey: 'tolkien|lotr',
        status: BOOK_STATUSES.NOT_STARTED,
        notionPageId: 'book-1',
        updatedAt: 90,
        owned: true
      },
      {
        asin: 'LOTR2-TEST',
        title: 'The Two Towers',
        author: 'J. R. R. Tolkien',
        seriesKey: 'tolkien|lotr',
        status: BOOK_STATUSES.IN_PROGRESS,
        notionPageId: 'book-2',
        updatedAt: 95,
        owned: true
      },
      {
        asin: 'LOTR3-TEST',
        title: 'The Return of the King',
        author: 'J. R. R. Tolkien',
        seriesKey: 'tolkien|lotr',
        status: BOOK_STATUSES.FINISHED,
        notionPageId: 'book-3',
        updatedAt: 80,
        owned: true
      }
    ]);

    const result = await cascadeIfNeeded({
      seriesKey: 'tolkien|lotr',
      asin: 'LOTR2-TEST',
      status: BOOK_STATUSES.LA_POUBELLE,
      seriesMatch: true
    });

    expect(result.seriesFinalStatus).toBe(BOOK_STATUSES.LA_POUBELLE);
    expect(result.updatedBookCount).toBe(2);
    expect(mocks.putBookMock).toHaveBeenCalledTimes(2);
    expect(mocks.updatePageMock).toHaveBeenCalledWith(
      'book-1',
      expect.objectContaining({ archived: false })
    );
    expect(mocks.putSeriesMock).toHaveBeenCalledWith(expect.objectContaining({
      seriesKey: 'tolkien|lotr',
      finalStatus: BOOK_STATUSES.LA_POUBELLE
    }));
  });

  it('sets series final status to Finished when all books are finished', async () => {
    mocks.getBookMock.mockResolvedValue({
      asin: 'LOTR3-TEST',
      title: 'The Return of the King',
      author: 'J. R. R. Tolkien',
      seriesKey: 'tolkien|lotr',
      status: BOOK_STATUSES.FINISHED,
      updatedAt: 120,
      owned: true
    });

    mocks.listBooksBySeriesMock.mockResolvedValue([
      {
        asin: 'LOTR1-TEST',
        title: 'The Fellowship of the Ring',
        author: 'J. R. R. Tolkien',
        seriesKey: 'tolkien|lotr',
        status: BOOK_STATUSES.FINISHED,
        notionPageId: 'book-1',
        updatedAt: 90,
        owned: true
      },
      {
        asin: 'LOTR2-TEST',
        title: 'The Two Towers',
        author: 'J. R. R. Tolkien',
        seriesKey: 'tolkien|lotr',
        status: BOOK_STATUSES.FINISHED,
        notionPageId: 'book-2',
        updatedAt: 95,
        owned: true
      },
      {
        asin: 'LOTR3-TEST',
        title: 'The Return of the King',
        author: 'J. R. R. Tolkien',
        seriesKey: 'tolkien|lotr',
        status: BOOK_STATUSES.FINISHED,
        notionPageId: 'book-3',
        updatedAt: 120,
        owned: true
      }
    ]);

    const result = await cascadeIfNeeded({
      seriesKey: 'tolkien|lotr',
      asin: 'LOTR3-TEST',
      status: BOOK_STATUSES.FINISHED,
      seriesMatch: true
    });

    expect(result.seriesFinalStatus).toBe(BOOK_STATUSES.FINISHED);
    expect(result.updatedBookCount).toBe(0);
    expect(mocks.putSeriesMock).toHaveBeenCalledWith(expect.objectContaining({
      finalStatus: BOOK_STATUSES.FINISHED
    }));
  });

  it('sets series final status to In progress when some books are finished and others not started', async () => {
    mocks.getBookMock.mockResolvedValue({
      asin: 'PARIS-FINISHED',
      title: 'Paris',
      author: 'Andy Warhol',
      seriesKey: 'paris|series',
      status: BOOK_STATUSES.FINISHED,
      updatedAt: 200,
      owned: true
    });

    mocks.listBooksBySeriesMock.mockResolvedValue([
      {
        asin: 'PARIS-FINISHED',
        title: 'Paris',
        author: 'Andy Warhol',
        seriesKey: 'paris|series',
        status: BOOK_STATUSES.FINISHED,
        notionPageId: 'paris-finished',
        updatedAt: 200,
        owned: true
      },
      {
        asin: 'PARIS-NOT-STARTED',
        title: 'Another Paris Title',
        author: 'Andy Warhol',
        seriesKey: 'paris|series',
        status: BOOK_STATUSES.NOT_STARTED,
        notionPageId: 'paris-not-started',
        updatedAt: 100,
        owned: true
      }
    ]);

    const result = await cascadeIfNeeded({
      seriesKey: 'paris|series',
      asin: 'PARIS-FINISHED',
      status: BOOK_STATUSES.FINISHED,
      seriesMatch: true
    });

    expect(result.seriesFinalStatus).toBe(BOOK_STATUSES.IN_PROGRESS);
    expect(mocks.putSeriesMock).toHaveBeenCalledWith(expect.objectContaining({
      finalStatus: BOOK_STATUSES.IN_PROGRESS
    }));
  });

  it('throws when the Notion final-status update fails so Dynamo is not updated', async () => {
    const notionError = new Error('rate limited');
    (notionError as Error & { status?: number }).status = 429;

    mocks.getBookMock.mockResolvedValue({
      asin: 'LOTR3-TEST',
      title: 'The Return of the King',
      author: 'J. R. R. Tolkien',
      seriesKey: 'tolkien|lotr',
      status: BOOK_STATUSES.FINISHED,
      notionPageId: 'book-3',
      updatedAt: 120,
      owned: true
    });

    mocks.listBooksBySeriesMock.mockResolvedValue([
      {
        asin: 'LOTR1-TEST',
        title: 'The Fellowship of the Ring',
        author: 'J. R. R. Tolkien',
        seriesKey: 'tolkien|lotr',
        status: BOOK_STATUSES.FINISHED,
        notionPageId: 'book-1',
        updatedAt: 90,
        owned: true
      },
      {
        asin: 'LOTR2-TEST',
        title: 'The Two Towers',
        author: 'J. R. R. Tolkien',
        seriesKey: 'tolkien|lotr',
        status: BOOK_STATUSES.FINISHED,
        notionPageId: 'book-2',
        updatedAt: 95,
        owned: true
      },
      {
        asin: 'LOTR3-TEST',
        title: 'The Return of the King',
        author: 'J. R. R. Tolkien',
        seriesKey: 'tolkien|lotr',
        status: BOOK_STATUSES.FINISHED,
        notionPageId: 'book-3',
        updatedAt: 120,
        owned: true
      }
    ]);

    mocks.updatePageMock.mockRejectedValue(notionError);

    await expect(
      cascadeIfNeeded({
        seriesKey: 'tolkien|lotr',
        asin: 'LOTR3-TEST',
        status: BOOK_STATUSES.FINISHED,
        seriesMatch: true
      })
    ).rejects.toThrow('rate limited');

    expect(mocks.putSeriesMock).not.toHaveBeenCalled();
  });

  it('skips cascade when seriesMatch is false', async () => {
    const result = await cascadeIfNeeded({
      seriesKey: 'standalone',
      asin: 'SA-1',
      status: BOOK_STATUSES.FINISHED,
      seriesMatch: false
    });

    expect(result.updatedBookCount).toBe(0);
    expect(result.seriesFinalStatus).toBe(BOOK_STATUSES.FINISHED);
    expect(mocks.listBooksBySeriesMock).not.toHaveBeenCalled();
  });
});
