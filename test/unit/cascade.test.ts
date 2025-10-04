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
      updatedAt: 100
    });

    mocks.listBooksBySeriesMock.mockResolvedValue([
      {
        asin: 'LOTR1-TEST',
        title: 'The Fellowship of the Ring',
        author: 'J. R. R. Tolkien',
        seriesKey: 'tolkien|lotr',
        status: BOOK_STATUSES.NOT_STARTED,
        notionPageId: 'book-1',
        updatedAt: 90
      },
      {
        asin: 'LOTR2-TEST',
        title: 'The Two Towers',
        author: 'J. R. R. Tolkien',
        seriesKey: 'tolkien|lotr',
        status: BOOK_STATUSES.IN_PROGRESS,
        notionPageId: 'book-2',
        updatedAt: 95
      },
      {
        asin: 'LOTR3-TEST',
        title: 'The Return of the King',
        author: 'J. R. R. Tolkien',
        seriesKey: 'tolkien|lotr',
        status: BOOK_STATUSES.FINISHED,
        notionPageId: 'book-3',
        updatedAt: 80
      }
    ]);

    const result = await cascadeIfNeeded({
      seriesKey: 'tolkien|lotr',
      asin: 'LOTR2-TEST',
      status: BOOK_STATUSES.LA_POUBELLE
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
      updatedAt: 120
    });

    mocks.listBooksBySeriesMock.mockResolvedValue([
      {
        asin: 'LOTR1-TEST',
        title: 'The Fellowship of the Ring',
        author: 'J. R. R. Tolkien',
        seriesKey: 'tolkien|lotr',
        status: BOOK_STATUSES.FINISHED,
        notionPageId: 'book-1',
        updatedAt: 90
      },
      {
        asin: 'LOTR2-TEST',
        title: 'The Two Towers',
        author: 'J. R. R. Tolkien',
        seriesKey: 'tolkien|lotr',
        status: BOOK_STATUSES.FINISHED,
        notionPageId: 'book-2',
        updatedAt: 95
      },
      {
        asin: 'LOTR3-TEST',
        title: 'The Return of the King',
        author: 'J. R. R. Tolkien',
        seriesKey: 'tolkien|lotr',
        status: BOOK_STATUSES.FINISHED,
        notionPageId: 'book-3',
        updatedAt: 120
      }
    ]);

    const result = await cascadeIfNeeded({
      seriesKey: 'tolkien|lotr',
      asin: 'LOTR3-TEST',
      status: BOOK_STATUSES.FINISHED
    });

    expect(result.seriesFinalStatus).toBe(BOOK_STATUSES.FINISHED);
    expect(result.updatedBookCount).toBe(0);
    expect(mocks.putSeriesMock).toHaveBeenCalledWith(expect.objectContaining({
      finalStatus: BOOK_STATUSES.FINISHED
    }));
  });
});
