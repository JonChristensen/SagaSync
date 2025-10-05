import 'dotenv/config';
import { loadConfig, logInfo, SAMPLE_LIBRARY } from '@shared';

async function main(): Promise<void> {
  const config = loadConfig();
  logInfo('invoke:sample (stub)', {
    stateMachineArn: config.stateMachineArn,
    sampleItems: SAMPLE_LIBRARY.length
  });
  // TODO: Invoke AWS Step Functions StartExecution for each sample book.
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
