import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({});
const cache = new Map<string, string>();

export async function getSecretValue(secretId: string): Promise<string> {
  if (cache.has(secretId)) {
    return cache.get(secretId)!;
  }

  const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!result.SecretString) {
    throw new Error(`Secret ${secretId} did not return a SecretString payload`);
  }

  cache.set(secretId, result.SecretString);
  return result.SecretString;
}
