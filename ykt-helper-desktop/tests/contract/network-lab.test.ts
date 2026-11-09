import {
  NetworkRecorder,
  NormalizerPipeline,
  parseNetworkFixture,
  replayNetworkFixture,
} from '@ykt/routing';
import { describe, expect, it } from 'vitest';

import { DevelopmentNetworkRecorder } from '../../apps/desktop/main/development-network-recorder.js';
import { shouldUseDevelopmentNetworkRecorder } from '../../apps/desktop/main/network-recorder-factory.js';

describe('network lab pipeline', () => {
  it('redacts credentials before records can be exported', () => {
    const recorder = new NetworkRecorder();
    recorder.addHttp({
      source: 'browser',
      phase: 'body',
      requestId: '1',
      method: 'POST',
      url: 'https://www.yuketang.cn/api/problem?token=url-secret',
      resourceType: 'XHR',
      statusCode: 200,
      durationMs: 12,
      requestHeaders: {
        Authorization: 'Bearer header-secret',
        Cookie: 'session=cookie-secret',
      },
      requestBody: JSON.stringify({ token: 'request-body-secret' }),
      responseHeaders: { 'Set-Cookie': 'response-secret' },
      body: JSON.stringify({ token: 'body-secret', answer: 'A' }),
      error: null,
    });

    const exported = JSON.stringify(recorder.entries);
    expect(exported).not.toContain('url-secret');
    expect(exported).not.toContain('header-secret');
    expect(exported).not.toContain('cookie-secret');
    expect(exported).not.toContain('response-secret');
    expect(exported).not.toContain('body-secret');
    expect(exported).not.toContain('request-body-secret');
    expect(exported).toContain('[REDACTED]');
  });

  it('enforces the bounded in-memory buffer', () => {
    const recorder = new NetworkRecorder({
      maxEntries: 2,
      maxBytes: 1_000_000,
    });
    for (let index = 0; index < 3; index += 1) {
      recorder.addWebSocket({
        source: 'fixture',
        requestId: String(index),
        url: 'wss://www.yuketang.cn/ws',
        direction: 'received',
        opcode: 1,
        payload: '{}',
        error: null,
      });
    }

    expect(recorder.entries).toHaveLength(2);
    expect(recorder.droppedEntries).toBe(1);
  });

  it('preserves complete unredacted API bodies in the development recorder', () => {
    const recorder = new DevelopmentNetworkRecorder();
    const body = JSON.stringify({
      token: 'development-token',
      courses: ['x'.repeat(80 * 1024)],
    });

    const entry = recorder.addHttp({
      source: 'browser',
      phase: 'body',
      requestId: 'course-list',
      method: 'GET',
      url: 'https://pro.yuketang.cn/v2/api/web/courses/list?identity=2',
      resourceType: 'XHR',
      statusCode: 200,
      durationMs: 12,
      requestHeaders: { Authorization: 'Bearer development-secret' },
      requestBody: JSON.stringify({ token: 'development-request-token' }),
      responseHeaders: { 'content-type': 'application/json' },
      body,
      error: null,
    });

    expect(recorder.captureProfile.mode).toBe('development');
    expect(recorder.captureProfile.deepCaptureByDefault).toBe(true);
    expect(entry?.body).toBe(body);
    expect(entry?.requestHeaders.Authorization).toBe(
      'Bearer development-secret',
    );
    expect(entry?.requestBody).toBe(
      JSON.stringify({ token: 'development-request-token' }),
    );
  });

  it('only selects the development recorder for unpackaged --debug runs', () => {
    expect(
      shouldUseDevelopmentNetworkRecorder(['electron', '.', '--debug'], false),
    ).toBe(true);
    expect(shouldUseDevelopmentNetworkRecorder(['electron', '.'], false)).toBe(
      false,
    );
    expect(
      shouldUseDevelopmentNetworkRecorder(['app.exe', '--debug'], true),
    ).toBe(false);
  });

  it('maps synthetic HTTP and WebSocket records before live traffic exists', () => {
    const fixture = parseNetworkFixture(`{
      "version": 1,
      "exportedAt": "2026-08-30T00:00:00.000Z",
      "entries": [
        {
          "id": "ws-1", "sequence": 1,
          "timestamp": "2026-08-30T00:00:01.000Z", "source": "fixture",
          "kind": "websocket", "requestId": "1",
          "url": "wss://www.yuketang.cn/ws", "direction": "received",
          "opcode": 1, "payload": "{\\"type\\":\\"problem\\"}", "error": null
        }
      ]
    }`);

    expect(replayNetworkFixture(fixture, new NormalizerPipeline())).toEqual([
      expect.objectContaining({
        kind: 'domain',
        eventType: 'problem.published',
        sourceEntryId: 'ws-1',
        source: 'fixture',
      }),
    ]);
  });
});
