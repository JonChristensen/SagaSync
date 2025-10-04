import { parseAudibleCsvFile } from '@shared';
import { fetch } from 'undici';

interface CliOptions {
  filePath: string;
  apiUrl?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const [, , ...rest] = argv;
  if (rest.length === 0) {
    throw new Error('Usage: npm run import:audible -- <path-to-audible-export.csv> [--api-url <https://...>] [--commit]');
  }

  let filePath = '';
  let apiUrl: string | undefined;
  let dryRun = true;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg) continue;

    if (!filePath && !arg.startsWith('--')) {
      filePath = arg;
      continue;
    }

    if (arg === '--api-url') {
      apiUrl = rest[i + 1];
      i += 1;
      continue;
    }

    if (arg === '--commit') {
      dryRun = false;
      continue;
    }
  }

  if (!filePath) {
    throw new Error('Missing path to Audible CSV export');
  }

  return {
    filePath,
    apiUrl,
    dryRun
  };
}

async function postToApi(apiUrl: string, body: unknown) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Import API responded with ${response.status} ${response.statusText}: ${text}`);
  }

  return response.json();
}

async function main() {
  const options = parseArgs(process.argv);
  const rows = await parseAudibleCsvFile(options.filePath);
  console.log(`Parsed ${rows.length} items from ${options.filePath}`);

  if (rows.length === 0) {
    console.warn('No rows were parsed; exiting.');
    return;
  }

  if (options.dryRun) {
    console.log('Dry run mode (default). First item preview:');
    console.log(JSON.stringify(rows[0], null, 2));
    console.log('Pass --commit to submit the payload.');
    return;
  }

  if (!options.apiUrl) {
    throw new Error('Missing --api-url while running in commit mode.');
  }

  const payload = { items: rows };
  const result = await postToApi(options.apiUrl, payload);
  console.log('Import API result:', JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
