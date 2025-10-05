import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handler as webhookStarted } from '@functions/api/webhookStarted';
import { handler as webhookFinished } from '@functions/api/webhookFinished';
import { BOOK_STATUSES } from '@shared';

const sharedMocks = vi.hoisted(() => {
  const loadConfigMock = vi.fn();
  const getSecretValueMock = vi.fn();
  const getBookMock = vi.fn();
  const putBookMock = vi.fn();
  const updatePageMock = vi.fn();
  const logErrorMock = vi.fn();
  const logInfoMock = vi.fn();

  return {
    loadConfigMock,
    getSecretValueMock,
    getBookMock,
    putBookMock,
    updatePageMock,
    logErrorMock,
    logInfoMock
  };
});

const cascadeMock = vi.hoisted(() => vi.fn());

vi.mock('@functions/cascade', () => ({
  handler: cascadeMock
}));

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
    getBook = sharedMocks.getBookMock;
    putBook = sharedMocks.putBookMock;
  }

  class MockNotionGateway {
    constructor(public token: string) {
      void token;
    }
    updatePage = sharedMocks.updatePageMock;
  }

  return {
    BOOK_STATUSES,
    loadConfig: sharedMocks.loadConfigMock,
    getSecretValue: sharedMocks.getSecretValueMock,
    DynamoGateway: MockDynamoGateway,
    NotionGateway: MockNotionGateway,
    buildBookStatusPatch: (status: string) => ({ properties: { Status: status } }),
    logError: sharedMocks.logErrorMock,
    logInfo: sharedMocks.logInfoMock
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  sharedMocks.loadConfigMock.mockReturnValue({
    notionTokenSecretName: 'notion/internal-token',
    seriesTableName: 'series-table',
    booksTableName: 'books-table'
  });
  sharedMocks.getSecretValueMock.mockResolvedValue('notion-token');
  sharedMocks.getBookMock.mockResolvedValue({
    asin: 'LOTR1-TEST',
    title: 'The Fellowship of the Ring',
    author: 'J. R. R. Tolkien',
    seriesKey: 'tolkien|lotr',
    status: BOOK_STATUSES.NOT_STARTED,
    notionPageId: 'book-page',
    updatedAt: 1,
    owned: true
  });
  sharedMocks.putBookMock.mockResolvedValue(undefined);
  sharedMocks.updatePageMock.mockResolvedValue(undefined);
  cascadeMock.mockResolvedValue({ updatedBookCount: 0, seriesFinalStatus: BOOK_STATUSES.NOT_STARTED });
});

describe('webhookStarted handler', () => {
  it('marks the book in progress and triggers cascade', async () => {
    const response = await webhookStarted({ asin: 'LOTR1-TEST' });

    expect(response.statusCode).toBe(202);
    expect(sharedMocks.putBookMock).toHaveBeenCalledWith(expect.objectContaining({
      asin: 'LOTR1-TEST',
      status: BOOK_STATUSES.IN_PROGRESS
    }));
    expect(sharedMocks.updatePageMock).toHaveBeenCalledWith(
      'book-page',
      expect.objectContaining({ archived: false })
    );
    expect(cascadeMock).toHaveBeenCalledWith({
      asin: 'LOTR1-TEST',
      seriesKey: 'tolkien|lotr',
      status: BOOK_STATUSES.IN_PROGRESS
    });
  });

  it('still triggers cascade when the book is already in progress', async () => {
    sharedMocks.getBookMock.mockResolvedValueOnce({
      asin: 'LOTR1-TEST',
      title: 'The Fellowship of the Ring',
      author: 'J. R. R. Tolkien',
      seriesKey: 'tolkien|lotr',
      status: BOOK_STATUSES.IN_PROGRESS,
      notionPageId: 'book-page',
      updatedAt: 1,
      owned: true
    });

    const response = await webhookStarted({ asin: 'LOTR1-TEST' });

    expect(response.statusCode).toBe(202);
    expect(sharedMocks.putBookMock).not.toHaveBeenCalled();
    expect(sharedMocks.updatePageMock).not.toHaveBeenCalled();
    expect(cascadeMock).toHaveBeenCalledWith({
      asin: 'LOTR1-TEST',
      seriesKey: 'tolkien|lotr',
      status: BOOK_STATUSES.IN_PROGRESS
    });
  });

  it('extracts ASIN from a Notion automation payload', async () => {
    const body = JSON.stringify({
      properties: {
        ASIN: {
          type: 'rich_text',
          rich_text: [
            {
              plain_text: 'LOTR1-TEST'
            }
          ]
        },
        Status: {
          type: 'status',
          status: {
            name: 'In progress'
          }
        }
      }
    });

    const response = await webhookStarted({ body });

    expect(response.statusCode).toBe(202);
    expect(sharedMocks.putBookMock).toHaveBeenCalledWith(expect.objectContaining({
      asin: 'LOTR1-TEST',
      status: BOOK_STATUSES.IN_PROGRESS
    }));
    expect(cascadeMock).toHaveBeenCalledWith({
      asin: 'LOTR1-TEST',
      seriesKey: 'tolkien|lotr',
      status: BOOK_STATUSES.IN_PROGRESS
    });
  });

  it('extracts ASIN from automation rows payload', async () => {
    const body = JSON.stringify({
      rows: [
        {
          properties: {
            ASIN: {
              type: 'rich_text',
              rich_text: [
                {
                  plain_text: 'LOTR1-TEST'
                }
              ]
            },
            Status: {
              type: 'status',
              status: {
                name: 'In progress'
              }
            }
          }
        }
      ]
    });

    const response = await webhookStarted({ body });

    expect(response.statusCode).toBe(202);
    expect(sharedMocks.putBookMock).toHaveBeenCalledWith(expect.objectContaining({
      asin: 'LOTR1-TEST',
      status: BOOK_STATUSES.IN_PROGRESS
    }));
    expect(cascadeMock).toHaveBeenCalledWith({
      asin: 'LOTR1-TEST',
      seriesKey: 'tolkien|lotr',
      status: BOOK_STATUSES.IN_PROGRESS
    });
  });
});

describe('webhookFinished handler', () => {
  it('marks the book finished and triggers cascade', async () => {
    const response = await webhookFinished({ asin: 'LOTR1-TEST' });

    expect(response.statusCode).toBe(202);
    expect(sharedMocks.putBookMock).toHaveBeenCalledWith(expect.objectContaining({
      asin: 'LOTR1-TEST',
      status: BOOK_STATUSES.FINISHED
    }));
    expect(sharedMocks.updatePageMock).toHaveBeenCalledWith(
      'book-page',
      expect.objectContaining({ archived: false })
    );
    expect(cascadeMock).toHaveBeenCalledWith({
      asin: 'LOTR1-TEST',
      seriesKey: 'tolkien|lotr',
      status: BOOK_STATUSES.FINISHED
    });
  });

  it('still triggers cascade when the book is already finished', async () => {
    sharedMocks.getBookMock.mockResolvedValueOnce({
      asin: 'LOTR1-TEST',
      title: 'The Fellowship of the Ring',
      author: 'J. R. R. Tolkien',
      seriesKey: 'tolkien|lotr',
      status: BOOK_STATUSES.FINISHED,
      notionPageId: 'book-page',
      updatedAt: 1,
      owned: true
    });

    const response = await webhookFinished({ asin: 'LOTR1-TEST' });

    expect(response.statusCode).toBe(202);
    expect(sharedMocks.putBookMock).not.toHaveBeenCalled();
    expect(sharedMocks.updatePageMock).not.toHaveBeenCalled();
    expect(cascadeMock).toHaveBeenCalledWith({
      asin: 'LOTR1-TEST',
      seriesKey: 'tolkien|lotr',
      status: BOOK_STATUSES.FINISHED
    });
  });

  it('handles a Notion automation payload that sets La Poubelle', async () => {
    const body = JSON.stringify({
      properties: {
        ASIN: {
          type: 'rich_text',
          rich_text: [
            {
              plain_text: 'LOTR1-TEST'
            }
          ]
        },
        Status: {
          type: 'status',
          status: {
            name: 'La Poubelle'
          }
        }
      }
    });

    const response = await webhookFinished({ body });

    expect(response.statusCode).toBe(202);
    expect(sharedMocks.putBookMock).toHaveBeenCalledWith(expect.objectContaining({
      asin: 'LOTR1-TEST',
      status: BOOK_STATUSES.LA_POUBELLE
    }));
    expect(cascadeMock).toHaveBeenCalledWith({
      asin: 'LOTR1-TEST',
      seriesKey: 'tolkien|lotr',
      status: BOOK_STATUSES.LA_POUBELLE
    });
  });

  it('handles automation rows payload for La Poubelle', async () => {
    const body = JSON.stringify({
      rows: [
        {
          properties: {
            ASIN: {
              type: 'rich_text',
              rich_text: [
                {
                  plain_text: 'LOTR1-TEST'
                }
              ]
            },
            Status: {
              type: 'status',
              status: {
                name: 'La Poubelle'
              }
            }
          }
        }
      ]
    });

    const response = await webhookFinished({ body });

    expect(response.statusCode).toBe(202);
    expect(sharedMocks.putBookMock).toHaveBeenCalledWith(expect.objectContaining({
      asin: 'LOTR1-TEST',
      status: BOOK_STATUSES.LA_POUBELLE
    }));
    expect(cascadeMock).toHaveBeenCalledWith({
      asin: 'LOTR1-TEST',
      seriesKey: 'tolkien|lotr',
      status: BOOK_STATUSES.LA_POUBELLE
    });
  });
});
