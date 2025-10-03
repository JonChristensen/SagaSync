# SagaSync Kanban Automation (Scaffold)

Serverless scaffolding that will ingest an audiobook library, enrich it with Open Library, and keep two Notion databases (Series + Books) in sync. This milestone focuses on infrastructure, typed contracts, request builders, and executable stubs so we can iterate toward production safely.

## Repository Layout
`
infra/                       # AWS CDK app (TypeScript)
functions/
  openLibraryLookup/
  upsertSeries/
  upsertBook/
  cascade/
  syncSeriesFinalStatus/
  api/
    import/
    webhookStarted/
    webhookFinished/
src/lib/                     # Shared types, helpers, Notion/Dynamo stubs, sample data
scripts/                     # Helper CLI scripts (e.g., invoke sample flow)
test/                        # Vitest unit + integration suites
`

## Infrastructure (CDK)
The CDK stack provisions:
- DynamoDB tables SagaSync-Series-<stage> and SagaSync-Books-<stage>.
- Lambda functions for each workflow step and API endpoint (Node.js 20).
- Step Functions state machine LookupSeriesMetadata ? UpsertSeries ? UpsertBook ? CascadeIfNeeded with generic retry/backoff.
- API Gateway routes: POST /import, POST /webhook/started, POST /webhook/finished.
- Secrets Manager access policy so service Lambdas can read the Notion integration token.
- Placeholder EventBridge rule (disabled) pointing at syncSeriesFinalStatus for future automation.
- CloudFormation outputs for the Step Functions ARN and deployed API URL.

Use 
pm run synth (or cd infra && npm run cdk:synth -- --context stage=dev) to confirm the template, then 
pm run deploy when you are ready.

## Function Contracts & Idempotency Notes
Shared TypeScript interfaces live in src/lib/types.ts. Every function stub imports these contracts so signatures are already aligned.

Key guards (to implement next):
- **Always read DynamoDB first.** If a Series record with 
otionPageId exists, skip Notion create calls. Books behave the same via sin.
- **Serialize series creation.** Use conditional writes or transactions on the Series table so concurrent executions race safely.
- **Redundant PATCH avoidance.** Compare the desired state (final status, book status, etc.) before performing Notion PATCH operations.
- **La Poubelle cascade (one way).** When any book enters La Poubelle, mark all Not started/In progress siblings likewise and set the Series Final Status = La Poubelle. Finished books stay untouched. Promotion out of La Poubelle should be manual for now.

## Notion Request Builders
src/lib/notionRequests.ts contains helper builders that emit the exact payload shapes we already validated:
- Create/Query Series by Series Key.
- Create/Query Books by ASIN.
- Patch Books (relations, status, purchased date, source, series order).
- Patch Series Final Status.
Always send these bodies with the headers documented below to avoid the common pitfalls (stringified JSON, missing Notion-Version, etc.).

### Required Headers for every Notion call
`
Authorization: Bearer <token>
Notion-Version: 2022-06-28
Content-Type: application/json
`

## Sample Data & Tests
- src/lib/sampleData.ts lists the four sample books (LOTR + HP). The same data drives unit tests and the invoke script.
- 	est/unit/openLibraryLookup.test.ts ensures fallback heuristics map the samples to The Lord of the Rings and Harry Potter.
- 	est/unit/*.test.ts scaffolds additional expectations (currently skipped) for series upserts and cascade behaviour.
- 	est/integration/workflow.test.ts smoke tests the intended Step Functions step order.
Run the suite with 
pm test.

## Scripts & Tooling
- 
pm run build – type-checks the entire project.
- 
pm test – runs Vitest.
- 
pm run synth / 
pm run deploy – proxy to CDK commands.
- 
pm run invoke:sample – placeholder CLI that will eventually drive Step Functions with the sample dataset.

## Environment Configuration
Populate .env (see .env.example) or equivalent Lambda environment variables:
- NOTION_TOKEN_SECRET_NAME=notion/internal-token
- NOTION_SERIES_DB_ID=<uuid>
- NOTION_BOOKS_DB_ID=<uuid>
- NOTION_VERSION=2022-06-28
- TZ=America/Denver
- SERIES_TABLE_NAME, BOOKS_TABLE_NAME (injected by CDK)
- STATE_MACHINE_ARN (set on the importer Lambda after deployment)

infra/cdk.json carries stage-specific Notion database IDs; pass --context stage=<stage> when synthesising/deploying.

## Known Pitfalls (call-outs)
- Notion expects property arrays (e.g., 	itle: [{ text: { content } }]). The builders adhere to this format—re-use them.
- JSON numbers must be emitted as numbers, not quoted strings. Avoid manual string interpolation when PATCHing Series Order.
- Missing Notion-Version header causes query responses to ignore filters; always set it.
- Step Functions retries must be safe: every Lambda should be idempotent so a re-run translates to a PATCH, not a duplicate POST.

## Next Implementation Tasks
1. Implement the DynamoDB and Notion gateways, including conditional writes for series/book idempotency and caching the latest statuses.
2. Wire the Open Library HTTP call with retries/backoff and merge the deterministic fallbacks.
3. Replace Lambda stubs with real logic (using the helpers above) and un-skip the behavioural tests.
4. Flesh out scripts/invokeSample.ts to start a Step Functions execution per sample book record.
5. Extend testing with mocks/fakes for Notion + DynamoDB to validate cascade rules end-to-end.

With this scaffold in place, we can now iterate on production behaviour while staying confident about payload shapes, infrastructure, and env wiring.
