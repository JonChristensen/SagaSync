import 'dotenv/config';
import { ENV_VARS } from './constants';

type RequiredKey =
  | typeof ENV_VARS.NOTION_TOKEN_SECRET_NAME
  | typeof ENV_VARS.NOTION_SERIES_DB_ID
  | typeof ENV_VARS.NOTION_BOOKS_DB_ID
  | typeof ENV_VARS.SERIES_TABLE_NAME
  | typeof ENV_VARS.BOOKS_TABLE_NAME;

export interface AppConfig {
  notionTokenSecretName: string;
  notionSeriesDatabaseId: string;
  notionBooksDatabaseId: string;
  seriesTableName: string;
  booksTableName: string;
  stateMachineArn?: string;
}

export function getEnv(key: string, required = true): string | undefined {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  const resolved: AppConfig = {
    notionTokenSecretName: getEnv(ENV_VARS.NOTION_TOKEN_SECRET_NAME as RequiredKey)!,
    notionSeriesDatabaseId: getEnv(ENV_VARS.NOTION_SERIES_DB_ID as RequiredKey)!,
    notionBooksDatabaseId: getEnv(ENV_VARS.NOTION_BOOKS_DB_ID as RequiredKey)!,
    seriesTableName: getEnv(ENV_VARS.SERIES_TABLE_NAME as RequiredKey)!,
    booksTableName: getEnv(ENV_VARS.BOOKS_TABLE_NAME as RequiredKey)!,
    stateMachineArn: getEnv(ENV_VARS.STATE_MACHINE_ARN, false)
  };

  return resolved;
}
