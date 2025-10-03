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
    return this.request<NotionPage>(`/v1/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  }
}
