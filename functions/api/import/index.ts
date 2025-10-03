import { randomUUID } from 'crypto';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import {
  ImportApiPayload,
  ImportApiResponse,
  StepFunctionInput,
  loadConfig,
  logError,
  logInfo
} from '@shared';

type ApiGatewayEvent = { body?: string };

function parsePayload(event: ApiGatewayEvent | ImportApiPayload): ImportApiPayload {
  if ('items' in event && Array.isArray(event.items)) {
    return { items: event.items };
  }

  if ('body' in event && typeof event.body === 'string') {
    const parsed = JSON.parse(event.body) as ImportApiPayload;
    return { items: parsed.items ?? [] };
  }

  return { items: [] };
}

const sfnClient = new SFNClient({});

function buildExecutionName(asin: string, index: number): string {
  const sanitized = asin.replace(/[^A-Za-z0-9-_]/g, '-').slice(0, 40) || 'item';
  const unique = randomUUID().split('-')[0];
  const name = `import-${sanitized}-${index}-${unique}`;
  return name.slice(0, 80);
}

async function startBookImportExecution(stateMachineArn: string, item: StepFunctionInput['item'], index: number) {
  const input: StepFunctionInput = { item };
  const command = new StartExecutionCommand({
    stateMachineArn,
    input: JSON.stringify(input),
    name: buildExecutionName(item.asin, index)
  });

  const result = await sfnClient.send(command);
  return result.executionArn ?? '';
}

export async function handler(event: ApiGatewayEvent | ImportApiPayload): Promise<{ statusCode: number; body: string }> {
  const payload = parsePayload(event);
  logInfo('Import API invoked', { items: payload.items.length });
  const config = loadConfig();
  if (!config.stateMachineArn) {
    logError('STATE_MACHINE_ARN is not configured');
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'State machine not configured' })
    };
  }

  const executionArns: string[] = [];
  for (const [index, item] of payload.items.entries()) {
    const executionArn = await startBookImportExecution(config.stateMachineArn, item, index);
    executionArns.push(executionArn);
  }

  const response: ImportApiResponse = {
    stateMachineExecutions: executionArns
  };
  return {
    statusCode: 202,
    body: JSON.stringify(response)
  };
}
