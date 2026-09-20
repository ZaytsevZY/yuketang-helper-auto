// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import type { DesktopApi } from '@ykt/contracts';
import AssignmentBody from '../../apps/desktop/renderer/src/components/AssignmentBody.vue';

let app: App | undefined;
const oldApi = window.yuketang;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
  window.yuketang = oldApi;
});
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}
function mount(getAsset: (...args: unknown[]) => Promise<{ dataUrl: string }>) {
  window.yuketang = { getAssignmentAsset: getAsset } as unknown as DesktopApi;
  const host = document.createElement('div');
  document.body.append(host);
  app = createApp({
    render: () =>
      h(AssignmentBody, {
        html: '<span class="xuetangx-com-encrypted-font">ABC</span>',
        fontUrl: 'https://pro.yuketang.cn/font.ttf',
      }),
  });
  app.mount(host);
  return host;
}
function message(frame: HTMLIFrameElement, type: string, token?: string) {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: frame.contentWindow,
      data: { type, token: token ?? /nonce="([^"]+)"/.exec(frame.srcdoc)![1] },
    }),
  );
}

describe('assignment frame lifecycle', () => {
  it('replaces the browsing context when resources arrive, rather than racing srcdoc navigation', async () => {
    let finish!: (result: { dataUrl: string }) => void;
    const host = mount(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await nextTick();
    const first = host.querySelector('iframe')!;
    expect(first.srcdoc).not.toContain('@font-face');
    finish({ dataUrl: 'data:font/ttf;base64,AAEAAAAA' });
    await flush();
    const second = host.querySelector('iframe')!;
    expect(second).not.toBe(first);
    expect(second.srcdoc).toContain('@font-face');
    expect(second.sandbox?.value ?? second.getAttribute('sandbox')).toBe(
      'allow-scripts',
    );
  });

  it('ignores stale or forged messages and forces a font at most once per detail', async () => {
    const get = vi.fn(async () => ({
      dataUrl: 'data:font/ttf;base64,AAEAAAAA',
    }));
    const host = mount(get);
    await flush();
    const first = host.querySelector('iframe')!;
    message(first, 'font-failed', 'wrong-token');
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
    message(first, 'font-failed');
    await flush();
    expect(get).toHaveBeenLastCalledWith(
      'https://pro.yuketang.cn/font.ttf',
      'font',
      true,
    );
    expect(get).toHaveBeenCalledTimes(2);
    message(host.querySelector('iframe')!, 'font-failed');
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('部分文字加载失败');
  });
});
