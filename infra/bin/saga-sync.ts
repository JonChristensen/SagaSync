#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { SagaSyncStack } from '../lib/saga-sync-stack';

const app = new App();

const stage = (app.node.tryGetContext('stage') as string | undefined) ?? 'dev';
const stages = (app.node.tryGetContext('stages') as Record<string, any> | undefined) ?? {};
const stageConfig = stages[stage];

if (!stageConfig) {
  throw new Error(`Missing stage configuration for '${stage}'. Pass --context stage=<stage>`);
}

new SagaSyncStack(app, `SagaSync-${stage}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-west-2'
  },
  stage,
  notionConfig: {
    seriesDatabaseId: stageConfig.notionSeriesDatabaseId,
    booksDatabaseId: stageConfig.notionBooksDatabaseId,
    tokenSecretName: stageConfig.notionTokenSecretName
  }
});
