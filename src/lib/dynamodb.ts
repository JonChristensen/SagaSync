import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { BookDynamoRecord, SeriesDynamoRecord } from './types';

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

export class DynamoGateway {
  constructor(private readonly seriesTableName: string, private readonly booksTableName: string) {}

  private get client(): DynamoDBDocumentClient {
    return documentClient;
  }

  async getSeries(seriesKey: string): Promise<SeriesDynamoRecord | null> {
    const command = new GetCommand({
      TableName: this.seriesTableName,
      Key: { seriesKey }
    });

    const { Item } = await this.client.send(command);
    return (Item as SeriesDynamoRecord | undefined) ?? null;
  }

  async putSeries(record: SeriesDynamoRecord): Promise<void> {
    const command = new PutCommand({
      TableName: this.seriesTableName,
      Item: record,
      ConditionExpression: 'attribute_not_exists(seriesKey) OR updatedAt < :updatedAt',
      ExpressionAttributeValues: {
        ':updatedAt': record.updatedAt
      }
    });

    await this.client.send(command);
  }

  async getBook(asin: string): Promise<BookDynamoRecord | null> {
    const command = new GetCommand({
      TableName: this.booksTableName,
      Key: { asin }
    });

    const { Item } = await this.client.send(command);
    return (Item as BookDynamoRecord | undefined) ?? null;
  }

  async putBook(record: BookDynamoRecord): Promise<void> {
    const command = new PutCommand({
      TableName: this.booksTableName,
      Item: record,
      ConditionExpression: 'attribute_not_exists(asin) OR updatedAt < :updatedAt',
      ExpressionAttributeValues: {
        ':updatedAt': record.updatedAt
      }
    });

    await this.client.send(command);
  }

  async listBooksBySeries(seriesKey: string): Promise<BookDynamoRecord[]> {
    const records: BookDynamoRecord[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const command = new ScanCommand({
        TableName: this.booksTableName,
        FilterExpression: 'seriesKey = :seriesKey',
        ExpressionAttributeValues: {
          ':seriesKey': seriesKey
        },
        ExclusiveStartKey: exclusiveStartKey
      });

      const { Items, LastEvaluatedKey } = await this.client.send(command);
      if (Items) {
        records.push(...(Items as BookDynamoRecord[]));
      }
      exclusiveStartKey = LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);

    return records;
  }
}
