import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { join } from 'path';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

export interface NotionConfig {
  readonly seriesDatabaseId: string;
  readonly booksDatabaseId: string;
  readonly tokenSecretName: string;
}

export interface SagaSyncStackProps extends StackProps {
  readonly stage: string;
  readonly notionConfig: NotionConfig;
}

export class SagaSyncStack extends Stack {
  constructor(scope: Construct, id: string, props: SagaSyncStackProps) {
    super(scope, id, props);

    const seriesTable = new dynamodb.Table(this, 'SeriesTable', {
      partitionKey: { name: 'seriesKey', type: dynamodb.AttributeType.STRING },
      removalPolicy: props.stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      tableName: `SagaSync-Series-${props.stage}`
    });

    const booksTable = new dynamodb.Table(this, 'BooksTable', {
      partitionKey: { name: 'asin', type: dynamodb.AttributeType.STRING },
      removalPolicy: props.stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      tableName: `SagaSync-Books-${props.stage}`
    });

    const notionToken = secretsmanager.Secret.fromSecretNameV2(
      this,
      'NotionTokenSecret',
      props.notionConfig.tokenSecretName
    );

    const defaultEnv: Record<string, string> = {
      SERIES_TABLE_NAME: seriesTable.tableName,
      BOOKS_TABLE_NAME: booksTable.tableName,
      NOTION_SERIES_DB_ID: props.notionConfig.seriesDatabaseId,
      NOTION_BOOKS_DB_ID: props.notionConfig.booksDatabaseId,
      NOTION_TOKEN_SECRET_NAME: props.notionConfig.tokenSecretName,
      NOTION_VERSION: '2022-06-28',
      TZ: 'America/Denver'
    };

    const nodeRuntime = lambda.Runtime.NODEJS_18_X;
    const bundlingOptions: lambdaNode.BundlingOptions = {
      sourceMap: true,
      tsconfig: join(__dirname, '../../tsconfig.json')
    };

    const createLambda = (id: string, relativeEntry: string, extraEnv: Record<string, string> = {}) =>
      new lambdaNode.NodejsFunction(this, id, {
        runtime: nodeRuntime,
        entry: join(__dirname, relativeEntry),
        handler: 'handler',
        environment: { ...defaultEnv, ...extraEnv },
        bundling: bundlingOptions,
        timeout: Duration.seconds(30)
      });

    const seriesMetadataFn = createLambda('SeriesMetadataFn', '../../functions/seriesMetadata/index.ts');
    const upsertSeriesFn = createLambda('UpsertSeriesFn', '../../functions/upsertSeries/index.ts');
    const upsertBookFn = createLambda('UpsertBookFn', '../../functions/upsertBook/index.ts');
    const cascadeFn = createLambda('CascadeFn', '../../functions/cascade/index.ts');
    const syncSeriesFn = createLambda('SyncSeriesFinalStatusFn', '../../functions/syncSeriesFinalStatus/index.ts');
    const importerFn = createLambda('ImportApiFn', '../../functions/api/import/index.ts');
    const webhookStartedFn = createLambda('WebhookStartedFn', '../../functions/api/webhookStarted/index.ts');
    const webhookFinishedFn = createLambda('WebhookFinishedFn', '../../functions/api/webhookFinished/index.ts');

    seriesTable.grantReadWriteData(upsertSeriesFn);
    seriesTable.grantReadData(upsertBookFn);
    seriesTable.grantReadWriteData(cascadeFn);
    seriesTable.grantReadWriteData(syncSeriesFn);
    seriesTable.grantReadWriteData(webhookStartedFn);
    seriesTable.grantReadWriteData(webhookFinishedFn);

    booksTable.grantReadWriteData(upsertBookFn);
    booksTable.grantReadWriteData(cascadeFn);
    booksTable.grantReadWriteData(webhookStartedFn);
    booksTable.grantReadWriteData(webhookFinishedFn);

    notionToken.grantRead(upsertSeriesFn);
    notionToken.grantRead(upsertBookFn);
    notionToken.grantRead(cascadeFn);
    notionToken.grantRead(syncSeriesFn);
    notionToken.grantRead(webhookStartedFn);
    notionToken.grantRead(webhookFinishedFn);

    const openLibraryStep = new tasks.LambdaInvoke(this, 'LookupSeriesMetadata', {
      lambdaFunction: seriesMetadataFn,
      outputPath: '$.Payload'
    });
    openLibraryStep.addRetry({ errors: ['States.TaskFailed'], interval: Duration.seconds(2), maxAttempts: 3, backoffRate: 2 });

    const upsertSeriesStep = new tasks.LambdaInvoke(this, 'UpsertSeries', {
      lambdaFunction: upsertSeriesFn,
      outputPath: '$.Payload'
    });
    upsertSeriesStep.addRetry({ errors: ['States.TaskFailed'], interval: Duration.seconds(2), maxAttempts: 3, backoffRate: 2 });

    const upsertBookStep = new tasks.LambdaInvoke(this, 'UpsertBook', {
      lambdaFunction: upsertBookFn,
      outputPath: '$.Payload'
    });
    upsertBookStep.addRetry({ errors: ['States.TaskFailed'], interval: Duration.seconds(2), maxAttempts: 3, backoffRate: 2 });

    const cascadeStep = new tasks.LambdaInvoke(this, 'CascadeIfNeeded', {
      lambdaFunction: cascadeFn,
      outputPath: '$.Payload'
    });
    cascadeStep.addRetry({ errors: ['States.TaskFailed'], interval: Duration.seconds(2), maxAttempts: 3, backoffRate: 2 });

    const workflowDefinition = openLibraryStep.next(upsertSeriesStep).next(upsertBookStep).next(cascadeStep);

    const stateMachine = new sfn.StateMachine(this, 'BookImportStateMachine', {
      stateMachineName: `SagaSync-BookImport-${props.stage}`,
      definitionBody: sfn.DefinitionBody.fromChainable(workflowDefinition),
      timeout: Duration.minutes(5)
    });

    importerFn.addEnvironment('STATE_MACHINE_ARN', stateMachine.stateMachineArn);
    stateMachine.grantStartExecution(importerFn);

    const api = new apigw.RestApi(this, 'SagaSyncApi', {
      restApiName: `SagaSyncService-${props.stage}`,
      deployOptions: {
        stageName: props.stage
      }
    });

    api.root.addResource('import').addMethod('POST', new apigw.LambdaIntegration(importerFn));

    const webhookResource = api.root.addResource('webhook');
    webhookResource.addResource('started').addMethod('POST', new apigw.LambdaIntegration(webhookStartedFn));
    webhookResource.addResource('finished').addMethod('POST', new apigw.LambdaIntegration(webhookFinishedFn));

    const placeholderRule = new events.Rule(this, 'FutureAutomationRule', {
      schedule: events.Schedule.rate(Duration.days(1)),
      enabled: false
    });
    placeholderRule.addTarget(new targets.LambdaFunction(syncSeriesFn));

    new CfnOutput(this, 'BookImportStateMachineArn', {
      value: stateMachine.stateMachineArn,
      exportName: `SagaSync-BookImportStateMachineArn-${props.stage}`
    });

    new CfnOutput(this, 'SagaSyncApiUrl', {
      value: api.url ?? 'https://example.com',
      exportName: `SagaSyncApiUrl-${props.stage}`
    });
  }
}
