import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, paginateScan } from '@aws-sdk/lib-dynamodb';
import { fetch } from 'undici';

interface SeriesSummary {
  asin: string;
  status: string;
}

interface CliOptions {
  apiUrl: string;
  booksTable: string;
  dryRun: boolean;
  region: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apiUrl: '',
    booksTable: process.env.BOOKS_TABLE_NAME ?? '',
    dryRun: false,
    region: process.env.AWS_REGION ?? 'us-east-1'
  };

  const [, , ...rest] = argv;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--api-url') {
      options.apiUrl = rest[++i] ?? '';
    } else if (arg === '--books-table') {
      options.booksTable = rest[++i] ?? '';
    } else if (arg === '--region') {
      options.region = rest[++i] ?? options.region;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
      i -= 1;
    }
  }

  if (!options.apiUrl) {
    throw new Error('Missing --api-url');
  }
  if (!options.booksTable) {
    throw new Error('Missing --books-table (or set BOOKS_TABLE_NAME env var)');
  }

  options.apiUrl = options.apiUrl.replace(/\/+$|$/, '/');
  return options;
}

async function collectSeriesSummaries(client: DynamoDBDocumentClient, tableName: string): Promise<Map<string, SeriesSummary>> {
  const seriesMap = new Map<string, SeriesSummary>();

  const paginator = paginateScan(
    { client },
    {
      TableName: tableName,
      ProjectionExpression: 'asin, seriesKey, #status, seriesMatch',
      ExpressionAttributeNames: {
        '#status': 'status'
      }
    }
  );

  for await (const page of paginator) {
    const items = page.Items ?? [];
    for (const item of items) {
      const seriesKey = typeof item.seriesKey === 'string' ? item.seriesKey : undefined;
      const asin = typeof item.asin === 'string' ? item.asin : undefined;
      const status = typeof item.status === 'string' ? item.status : undefined;
      const seriesMatch = item.seriesMatch;
      if (!seriesKey || !asin || !status) continue;

      if (seriesMatch === false) continue;

      if (!seriesMap.has(seriesKey)) {
        seriesMap.set(seriesKey, { asin, status });
      }
    }
  }

  return seriesMap;
}

async function invokeWebhook(apiUrl: string, summary: SeriesSummary, dryRun: boolean): Promise<void> {
  const path = summary.status === 'In progress' ? 'webhook/started' : 'webhook/finished';
  const url = `${apiUrl}${path}`;

  const payload =
    summary.status === 'In progress'
      ? { asin: summary.asin }
      : { asin: summary.asin, status: summary.status };

  if (dryRun) {
    console.log(`[dry-run] Would POST ${url} with ${JSON.stringify(payload)}`);
    return;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Webhook ${url} failed: ${response.status} ${response.statusText} ${text}`);
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv);
    const dynamoClient = new DynamoDBClient({ region: options.region });
    const documentClient = DynamoDBDocumentClient.from(dynamoClient, {
      marshallOptions: { removeUndefinedValues: true }
    });

    console.log(`Scanning ${options.booksTable} for series summaries...`);
    const summaries = await collectSeriesSummaries(documentClient, options.booksTable);
    console.log(`Found ${summaries.size} series`);

    let index = 0;
    for (const [seriesKey, summary] of summaries) {
      index += 1;
      console.log(`(${index}/${summaries.size}) ${seriesKey} → ${summary.status}`);
      try {
        await invokeWebhook(options.apiUrl, summary, options.dryRun);
      } catch (error) {
        console.error(`Failed to recompute series ${seriesKey}:`, error);
      }
    }

    console.log('Series recomputation complete.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

void main();
