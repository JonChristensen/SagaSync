import { fetch, type RequestInit } from 'undici';
import { NOTION_VERSION } from './constants';
import {
  NotionCreatePagePayload,
  NotionPage,
  NotionPatchPagePayload,
  NotionQueryPayload,
  NotionQueryResponse
} from './types';

interface NotionErrorBody {
  status?: number;
  code?: string;
  message?: string;
}

export class NotionGateway {
  constructor(private readonly token: string) {}

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = await fetch(`https://api.notion.com${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
          ...(init.headers ?? {})
        }
      });

      const text = await response.text();
      let parsed: T | NotionErrorBody | string = {};
      if (text.length) {
        try {
          parsed = JSON.parse(text) as T | NotionErrorBody;
        } catch {
          parsed = text;
        }
      }

      if (response.status === 429 && attempt < maxAttempts - 1) {
        const retryAfterHeader = response.headers.get('retry-after');
        const retryMs = retryAfterHeader ? Number.parseFloat(retryAfterHeader) * 1000 : 500 * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryMs) ? retryMs : 500));
        continue;
      }

      if (!response.ok) {
        const errorBody = typeof parsed === 'object' ? (parsed as NotionErrorBody) : undefined;
        const errorMessage = errorBody?.message ?? `Notion request failed with status ${response.status}`;
        const error = new Error(errorMessage);
        (error as Error & { status?: number; code?: string }).status = response.status;
        (error as Error & { status?: number; code?: string }).code = errorBody?.code;
        throw error;
      }

      return parsed as T;
    }

    throw new Error('Notion request exceeded maximum retries');
  }

  async queryDatabase(databaseId: string, payload: NotionQueryPayload): Promise<NotionQueryResponse> {
    return this.request<NotionQueryResponse>(`/v1/databases/${databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async createPage(payload: NotionCreatePagePayload): Promise<NotionPage> {
    return this.request<NotionPage>('/v1/pages', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async updatePage(pageId: string, payload: NotionPatchPagePayload): Promise<NotionPage> {
    const maxAttempts = 3;
    let attempt = 0;
    let lastError: Error | undefined;

    while (attempt < maxAttempts) {
      try {
        return await this.request<NotionPage>(`/v1/pages/${pageId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
      } catch (error) {
        const status = (error as { status?: number }).status;
        const code = (error as { code?: string }).code;
        lastError = error as Error;
        const isConflict = status === 409 || code === 'conflict_error';
        attempt += 1;

        if (!isConflict || attempt >= maxAttempts) {
          throw lastError;
        }

        // brief backoff before retrying to allow Notion to settle
        await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
      }
    }

    throw lastError ?? new Error('Unexpected failure updating Notion page');
  }
}
