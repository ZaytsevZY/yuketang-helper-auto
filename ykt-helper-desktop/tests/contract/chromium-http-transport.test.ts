import { describe, expect, it, vi } from 'vitest';

import { ChromiumHttpTransport } from '../../apps/desktop/main/chromium-http-transport.js';

describe('ChromiumHttpTransport', () => {
  it('uses the browser session cookie jar instead of a copied Cookie header', async () => {
    let requestInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => {
      requestInit = init;
      return new Response(JSON.stringify({ code: 0 }), {
        status: 200,
        headers: { 'set-auth': 'Bearer refreshed' },
      });
    });
    const transport = new ChromiumHttpTransport({ fetch: fetcher });

    const response = await transport.request({
      method: 'POST',
      url: 'https://www.yuketang.cn/api/v3/lesson/checkin',
      headers: {
        cookie: 'session=copied',
        authorization: 'Bearer current',
        'x-client': 'h5',
      },
      body: '{"lessonId":"7"}',
    });

    const headers = new Headers(requestInit?.headers);
    expect(requestInit).toMatchObject({
      method: 'POST',
      body: '{"lessonId":"7"}',
      credentials: 'include',
    });
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('authorization')).toBe('Bearer current');
    expect(headers.get('x-client')).toBe('h5');
    expect(response).toEqual({
      status: 200,
      headers: expect.objectContaining({ 'set-auth': 'Bearer refreshed' }),
      body: { code: 0 },
    });
  });

  it('preserves non-JSON response bodies', async () => {
    const transport = new ChromiumHttpTransport({
      fetch: async () => new Response('plain text', { status: 202 }),
    });

    await expect(
      transport.request({
        method: 'GET',
        url: 'https://www.yuketang.cn/api/ping',
        headers: {},
        body: null,
      }),
    ).resolves.toMatchObject({ status: 202, body: 'plain text' });
  });
});
