# SagaSync Infrastructure

This package contains the AWS CDK (v2) application that deploys the SagaSync
API, Step Functions workflow, and supporting Lambda + DynamoDB resources.

## Prerequisites

- Node.js 18+
- AWS CLI configured for the target account (`aws sts get-caller-identity` should work)
- CDK bootstrap stack in each target region/account: `cdk bootstrap aws://<account>/<region>`
- Fill in the Notion context values in `infra/cdk.json` for each stage before a
  production deploy.

## Install

```bash
npm install    # from repo root
cd infra && npm install
```

## Useful Commands

```bash
npm run build        # type-check + emit JS for the CDK app
npm run cdk:synth    # synthesise CloudFormation templates into cdk.out
npm run cdk:diff     # compare local template with deployed stack
npm run cdk:deploy   # deploy the stack (use -- --profile <name> if needed)
```

By default the CDK app deploys the `dev` stage. To target a different stage,
pass the context explicitly, for example:

```bash
npm run cdk:deploy -- --context stage=prod
```

## Deployment Notes

- The Lambda functions are built with esbuild via `NodejsFunction` and target the
  Node.js 18 runtime (matching the runtime used for bundling).
- Step Functions definitions now use `DefinitionBody.fromChainable` to comply
  with the CDK v2 deprecation notice on the older `definition` property.
- DynamoDB tables default to `DESTROY` in non-prod environments; adjust the
  removal policy in `SagaSyncStack` if you need stricter retention for testing.
- Ensure the referenced Notion secret (`notion/internal-token` by default)
  exists in AWS Secrets Manager before invoking the Lambdas.

