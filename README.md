# SagaSync Audiobook Sync

SagaSync keeps your audiobook library, enriched metadata, and Notion dashboards in lockstep. The current iteration focuses on:

- Ingesting Audible exports and normalising them into a shared data model.
- Enriching every title with Open Library series metadata (including volumes you do **not** own yet).
- Writing canonical records to DynamoDB for idempotent retries.
- Mirroring series + book state into Notion with cascade rules and webhook updates.

## Repository Layout
```
infra/                       # AWS CDK app (TypeScript)
functions/                   # Lambda handlers (Open Library, upserts, cascade, webhooks)
src/lib/                     # Shared helpers, request builders, Dynamo/Notion gateway
scripts/                     # CLI utilities (sample invoke, Audible import)
test/                        # Vitest unit + integration suites
```

## Quick Start
1. **Install & build**
   ```bash
   npm install
   npm run build
   npm test
   ```
2. **Configure AWS/Notion**
   - Copy `.env.example` → `.env` and fill in Notion database IDs + Secrets Manager name.
   - Deploy infrastructure: `npm run deploy` (wraps `cdk deploy`).
3. **Seed with Audible data**
   - `npm run audible:export` opens a Playwright-powered Chromium window (session cached under `.auth/audible`). Log in once if prompted; the script downloads the latest CSV to `./downloads/audible-library-<timestamp>.csv` by default.
   - Preview the import from that CSV:
     ```bash
     npm run import:audible -- downloads/audible-library-2025-10-03T19-30-00.csv
     ```
   - When you’re ready, POST it to the deployed API:
     ```bash
     npm run import:audible -- downloads/audible-library-2025-10-03T19-30-00.csv \
       --api-url https://<api-id>.execute-api.us-east-1.amazonaws.com/dev/import \
       --commit
     ```
   - Imports are idempotent: re-running the same CSV only patches existing records.
4. **Webhooks**
   - Audible listening status updates can POST to `/webhook/started` or `/webhook/finished`. They update Dynamo/Notion, then invoke the cascade logic so series state stays consistent.

## How retry-safe imports work
- **Dynamo first** – Every handler reads DynamoDB before writing. Existing records short-circuit create calls; updates use conditional puts to avoid race conditions.
- **Series enrichment** – After importing a book, we fetch all volumes from Open Library. Missing volumes are inserted with a synthetic `virtual:<seriesKey>-<slug>` ASIN and `owned=false`. When you eventually own that book, the real import replaces the virtual entry instead of duplicating it.
- **Notion mirrors** – Notion pages carry the same flags (`Status`, `Owned`, etc.). Synthetic volumes default to `Owned = No`; owned titles flip to `Yes` automatically.
- **Cleanup** – To wipe synthetic volumes, delete Dynamo rows where `owned=false` (and optionally archive the matching Notion pages). Real Audible imports recreate them as needed.

## Scripts & Tooling
- `npm run build` – type checks the repo.
- `npm test` – runs the Vitest suite.
- `npm run synth` / `npm run deploy` – CDK synth & deploy wrappers.
- `npm run invoke:sample` – drives the Step Functions state machine with sample payloads.
- `npm run audible:export [--output <dir>] [--headless]` – launches Playwright, lets you log in to Audible, and downloads the CSV export (stored in `./downloads` by default).
- `npm run import:audible -- <file> [--api-url <url>] [--commit]` – parses Audible exports and optionally POSTs them to the import API.

## Environment configuration
Set the following (via `.env`, shell exports, or Lambda configuration):

| Variable | Purpose |
| --- | --- |
| `NOTION_TOKEN_SECRET_NAME` | Name of the Secrets Manager secret that stores the Notion integration token. |
| `NOTION_SERIES_DB_ID` | Notion Series database ID. |
| `NOTION_BOOKS_DB_ID` | Notion Books database ID. |
| `NOTION_VERSION` | Notion API version (`2022-06-28`). |
| `TZ` | Time zone (`America/Denver` by default). |

CDK injects `SERIES_TABLE_NAME`, `BOOKS_TABLE_NAME`, and Step Functions environment variables during deployment.

## Testing
- Unit tests live under `test/unit`. Many use mocks for Dynamo/Notion/Open Library.
- `test/integration/workflow.test.ts` ensures the Step Functions definition lines up with expectations.
- Add new tests alongside the relevant module; `npm test` runs everything headlessly.

## Known limitations
- Open Library coverage isn’t perfect; some series may return incomplete volume lists.
- Audible export parsing assumes the standard column headers. If the format shifts, update `src/lib/audible.ts`.
- Webhook endpoints currently accept minimal payloads (asin + optional status). Broader metadata will require schema updates.

## Future enhancements
- Automated cleanup CLI for synthetic (`owned=false`) volumes.
- Full Step Functions integration tests with mocked Notion/Dynamo clients.
- Additional data sources for series/enrichment when Open Library falls short.
- Optional scheduler to refresh series metadata periodically.

With these pieces in place, you can safely iterate on the logic, redeploy often, and retry imports without corrupting your Notion workspace.
