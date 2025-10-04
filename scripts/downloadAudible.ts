import path from 'path';
import { mkdir } from 'fs/promises';
import { chromium } from 'playwright';

interface CliOptions {
  outputDir: string;
  headless: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const [, , ...rest] = argv;
  let outputDir = path.resolve(process.cwd(), 'downloads');
  let headless = false;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg) continue;

    if (arg === '--output' || arg === '-o') {
      const value = rest[i + 1];
      if (!value) throw new Error('Missing value for --output');
      outputDir = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }

    if (arg === '--headless') {
      headless = true;
      continue;
    }
  }

  return { outputDir, headless };
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

async function main() {
  const { outputDir, headless } = parseArgs(process.argv);
  await ensureDir(outputDir);

  const userDataDir = path.resolve(process.cwd(), '.auth', 'audible');
  await ensureDir(userDataDir);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    acceptDownloads: true
  });

  const page = await context.newPage();
  console.log('Opening Audible library...');
  await page.goto('https://www.audible.com/lib');

  // Wait for user to login if necessary.
  if (!(await page.locator('text=Export').first().isVisible())) {
    console.log('If prompted, complete the Audible login in the browser window.');
    await page.waitForSelector('text=Export', { timeout: 0 });
  }

  console.log('Requesting export...');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.goto('https://www.audible.com/lib/export', { waitUntil: 'networkidle' })
  ]);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(outputDir, `audible-library-${timestamp}.csv`);
  await download.saveAs(filePath);
  console.log(`Saved export to ${filePath}`);

  await context.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
