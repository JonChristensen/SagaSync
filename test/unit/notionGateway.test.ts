import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotionGateway } from '@shared';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('undici', () => ({
  fetch: fetchMock
}));

describe('NotionGateway', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('sends authorized requests with JSON payloads', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ results: [] })
    });

    const gateway = new NotionGateway('secret-token');
    await gateway.queryDatabase('db-123', { filter: { foo: 'bar' } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe('https://api.notion.com/v1/databases/db-123/query');
    expect(options?.method).toBe('POST');
    expect(options?.body).toBe(JSON.stringify({ filter: { foo: 'bar' } }));
    expect(options?.headers).toMatchObject({
      Authorization: 'Bearer secret-token',
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    });
  });

  it('throws when the Notion API responds with an error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ message: 'Not found', code: 'object_not_found' })
    });

    const gateway = new NotionGateway('secret-token');
    await expect(
      gateway.updatePage('page-id', { properties: {} })
    ).rejects.toThrow('Not found');
  });
});
