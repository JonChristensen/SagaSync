import {
  BookStatus,
  NotionCreatePagePayload,
  NotionPatchPagePayload,
  NotionQueryPayload,
  NotionRelationProperty,
  NotionRichTextProperty,
  NotionStatusProperty,
  NotionTitleProperty,
  NotionNumberProperty,
  NotionDateProperty,
  NotionSelectProperty,
  NotionPropertyValue
} from './types';

function titleProperty(content: string): NotionTitleProperty {
  return { title: [{ text: { content } }] };
}

function richTextProperty(content: string): NotionRichTextProperty {
  return { rich_text: [{ text: { content } }] };
}

function statusProperty(name: BookStatus): NotionStatusProperty {
  return { status: { name } };
}

function relationProperty(pageId: string): NotionRelationProperty {
  return { relation: [{ id: pageId }] };
}

function numberProperty(value: number | null): NotionNumberProperty {
  return { number: value };
}

function dateProperty(start: string | null): NotionDateProperty {
  return { date: start ? { start } : null };
}

function selectProperty(name: string): NotionSelectProperty {
  return { select: { name } };
}

export function buildSeriesQueryPayload(seriesKey: string): NotionQueryPayload {
  return {
    filter: {
      property: 'Series Key',
      rich_text: {
        equals: seriesKey
      }
    },
    page_size: 1
  };
}

export function buildSeriesCreatePayload(databaseId: string, seriesName: string, seriesKey: string): NotionCreatePagePayload {
  return {
    parent: { database_id: databaseId },
    properties: {
      Name: titleProperty(seriesName),
      'Series Key': richTextProperty(seriesKey)
    }
  };
}

export function buildSeriesFinalStatusPatch(finalStatus: BookStatus): NotionPatchPagePayload {
  return {
    properties: {
      'Final Status': statusProperty(finalStatus)
    }
  };
}

export function buildBookQueryPayload(asin: string): NotionQueryPayload {
  return {
    filter: {
      property: 'ASIN',
      rich_text: {
        equals: asin
      }
    },
    page_size: 1
  };
}

export interface BookPropertiesArgs {
  title: string;
  asin: string;
  status: BookStatus;
  seriesPageId: string;
  seriesOrder: number | null;
  purchasedAt: string;
  source: string;
}

export function buildBookCreatePayload(databaseId: string, props: BookPropertiesArgs): NotionCreatePagePayload {
  return {
    parent: { database_id: databaseId },
    properties: buildBookProperties(props)
  };
}

export function buildBookPatchPayload(props: BookPropertiesArgs): NotionPatchPagePayload {
  return {
    properties: buildBookProperties(props)
  };
}

export function buildBookStatusPatch(status: BookStatus): NotionPatchPagePayload {
  return {
    properties: {
      Status: statusProperty(status)
    }
  };
}

function buildBookProperties(props: BookPropertiesArgs): Record<string, NotionPropertyValue> {
  return {
    Name: titleProperty(props.title),
    ASIN: richTextProperty(props.asin),
    Status: statusProperty(props.status),
    Series: relationProperty(props.seriesPageId),
    'Series Order': numberProperty(props.seriesOrder),
    'Purchased At': dateProperty(props.purchasedAt),
    Source: selectProperty(props.source)
  };
}
