import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DynamoGateway } from '@shared';

const { sendMock, fromMock, FakeGetCommand, FakePutCommand } = vi.hoisted(() => {
  const sendMock = vi.fn();
  const fromMock = vi.fn(() => ({ send: sendMock }));

  class FakeGetCommand {
    constructor(public input: unknown) {}
  }

  class FakePutCommand {
    constructor(public input: unknown) {}
  }

  return { sendMock, fromMock, FakeGetCommand, FakePutCommand };
});

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {}
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: fromMock },
  GetCommand: FakeGetCommand,
  PutCommand: FakePutCommand
}));

describe('DynamoGateway', () => {
  beforeEach(() => {
    sendMock.mockReset();
    fromMock.mockClear();
  });

  it('returns existing series records', async () => {
    sendMock.mockResolvedValueOnce({
      Item: { seriesKey: 'lotr', seriesName: 'The Lord of the Rings', updatedAt: 123 }
    });

    const gateway = new DynamoGateway('SeriesTable', 'BooksTable');
    const record = await gateway.getSeries('lotr');

    expect(record?.seriesKey).toBe('lotr');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0] as InstanceType<typeof FakeGetCommand>;
    expect(command.input).toEqual({ TableName: 'SeriesTable', Key: { seriesKey: 'lotr' } });
  });

  it('returns null when the book is missing', async () => {
    sendMock.mockResolvedValueOnce({ Item: undefined });

    const gateway = new DynamoGateway('SeriesTable', 'BooksTable');
    const record = await gateway.getBook('HP1');

    expect(record).toBeNull();
    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0] as InstanceType<typeof FakeGetCommand>;
    expect(command.input).toEqual({ TableName: 'BooksTable', Key: { asin: 'HP1' } });
  });

  it('writes series with conditional guard', async () => {
    sendMock.mockResolvedValueOnce({});

    const gateway = new DynamoGateway('SeriesTable', 'BooksTable');
    const record = {
      seriesKey: 'hp',
      seriesName: 'Harry Potter',
      notionPageId: 'notion-series-id',
      updatedAt: 456
    };
    await gateway.putSeries(record);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0] as InstanceType<typeof FakePutCommand>;
    expect(command.input).toMatchObject({
      TableName: 'SeriesTable',
      Item: record,
      ConditionExpression: 'attribute_not_exists(seriesKey) OR updatedAt < :updatedAt',
      ExpressionAttributeValues: {
        ':updatedAt': record.updatedAt
      }
    });
  });
});

