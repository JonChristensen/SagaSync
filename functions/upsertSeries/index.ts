import {
  DynamoGateway,
  SeriesDynamoRecord,
  SeriesMetadataResult,
  UpsertSeriesOutput,
  buildSeriesCreatePayload,
  buildSeriesQueryPayload,
  getSecretValue,
  loadConfig,
  logError,
  logInfo,
  NotionGateway
} from '@shared';

function isConditionalCheckFailed(error: unknown): boolean {
  return (error as { name?: string } | undefined)?.name === 'ConditionalCheckFailedException';
}

type UpsertSeriesEvent = SeriesMetadataResult;

export async function handler(event: UpsertSeriesEvent): Promise<UpsertSeriesEvent & UpsertSeriesOutput> {
  logInfo('UpsertSeries invoked', { seriesKey: event.seriesKey });

  if (event.seriesMatch === false) {
    logInfo('Skipping series upsert for standalone book', { seriesKey: event.seriesKey });
    return { ...event, seriesId: undefined };
  }

  const config = loadConfig();
  const dynamo = new DynamoGateway(config.seriesTableName, config.booksTableName);
  const existing = await dynamo.getSeries(event.seriesKey);

  if (existing?.notionPageId) {
    logInfo('Series already recorded', { seriesKey: event.seriesKey });
    return { ...event, seriesId: existing.notionPageId };
  }

  const token = await getSecretValue(config.notionTokenSecretName);
  const notion = new NotionGateway(token);

  let notionPageId = existing?.notionPageId;

  if (!notionPageId) {
    const queryResponse = await notion.queryDatabase(
      config.notionSeriesDatabaseId,
      buildSeriesQueryPayload(event.seriesKey)
    );

    notionPageId = queryResponse.results[0]?.id;
  }

  if (!notionPageId) {
    const created = await notion.createPage(
      buildSeriesCreatePayload(config.notionSeriesDatabaseId, event.seriesName, event.seriesKey)
    );
    notionPageId = created.id;
  }

  if (!notionPageId) {
    logError('Failed to resolve Notion page ID for series', { seriesKey: event.seriesKey });
    throw new Error('Unable to determine Notion series page');
  }

  const record: SeriesDynamoRecord = {
    seriesKey: event.seriesKey,
    seriesName: event.seriesName,
    notionPageId,
    finalStatus: existing?.finalStatus,
    updatedAt: Date.now()
  };

  try {
    await dynamo.putSeries(record);
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      const latest = await dynamo.getSeries(event.seriesKey);
      if (latest?.notionPageId) {
        return { ...event, seriesId: latest.notionPageId };
      }
    }
    throw error;
  }

  return {
    ...event,
    seriesId: notionPageId
  };
}
