# SagaSync TODO

- [x] Configure Notion database IDs (dev) in CDK and .env
- [x] Deploy dev stack with updated import Lambda, Dynamo, and Notion gateways
- [x] Create Secrets Manager entry `notion/internal-token`
- [x] Fix `UpsertBook` Dynamo read: ensure `asin` is always provided before calling `getBook` to resolve ValidationException
- [x] Re-run `/import` after fixing `asin` handling and verify Step Functions execution succeeds end-to-end
- [x] Add unit tests for Dynamo/Notion gateways and new Lambda logic (mocked AWS/Notion clients)
- [x] Implement remaining TODOs (Open Library HTTP call, cascade logic, webhook handlers)
- [x] Build CLI to parse Audible library export CSV into normalized rows
- [ ] Wire CLI to invoke the import workflow (local + deployed) for turnkey re-runs
- [x] Enrich series with missing volumes and mark "not owned" books in Dynamo/Notion
- [ ] Add guardrails for retrying (dry-run mode, idempotent tagging, optional cleanup)
- [ ] Document Audible import workflow + retry semantics in README
- [x] Deploy latest Lambda changes (`npm run deploy`) and verify import flow still succeeds
- [x] Investigate Notion page archival status before patching existing book pages
