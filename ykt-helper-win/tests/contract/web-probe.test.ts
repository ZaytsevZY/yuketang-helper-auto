import { describe, expect, it, vi } from 'vitest';
import { analyzeWebSource } from '../../apps/desktop/main/web-source-analysis.js';
import {
  assertWebProbeUrl,
  readBounded,
  WebProbeController,
  type WebProbePage,
} from '../../apps/desktop/main/web-probe-controller.js';
import { NetworkRecorder } from '@ykt/routing';

const pageUrl = 'https://pro.yuketang.cn/v2/web/studentLog/123';
const bundleUrl =
  'https://fe-static-yuketang.yuketang.cn/fe/static/web/9.9/js/pc.js';

describe('web source discovery', () => {
  it('restores nested and absolute routes with names and original source positions', () => {
    const result = analyzeWebSource(
      `\nconst routes=[{path:'/course/:cid',name:'course',children:[{path:'exercise/:id',component:()=>import('./exercise.ab.js')},{path:'/subject',redirect:'/home'}]}];`,
      bundleUrl,
    );
    expect(
      result.findings
        .filter((f) => f.kind === 'route')
        .map((f) => [f.path, f.parent]),
    ).toEqual([
      ['/course/:cid', null],
      ['/course/:cid/exercise/:id', '/course/:cid'],
      ['/subject', '/course/:cid'],
    ]);
    expect(result.findings[0]).toMatchObject({
      name: 'course',
      parameters: ['cid'],
      evidence: { line: 2, sourceUrl: bundleUrl },
    });
    expect(result.assets).toEqual([
      {
        url: new URL('./exercise.ab.js', bundleUrl).href,
        discoveredBy: 'import',
      },
    ]);
  });

  it('resolves scoped API prefixes, concat/templates, methods and explicit parameter keys', () => {
    const source = `const p='/v2/api/web'; const api={studentQuiz:e=>http({url:p+'/studentQuiz',method:'get',params:{exam_id:e,classroom_id:1}})}; function other(p){return client.get(p+'/cover')} client.post('/api/save'); const link=\`/subject?type=5&classroom=\${cid}\`; const suffix='/v/exam'.concat('/cover');`;
    const findings = analyzeWebSource(source, bundleUrl).findings;
    expect(findings).toContainEqual(
      expect.objectContaining({
        kind: 'api',
        path: '/v2/api/web/studentQuiz',
        method: 'GET',
        name: 'studentQuiz',
        parameters: ['exam_id', 'classroom_id'],
      }),
    );
    expect(findings).not.toContainEqual(
      expect.objectContaining({ path: '/v2/api/web/cover' }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ method: 'POST', path: '/api/save' }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        path: '/subject?type=5&classroom={cid}',
        parameters: ['type', 'classroom', 'cid'],
      }),
    );
  });

  it('keeps unresolved expressions conservative and never evaluates code', () => {
    const result = analyzeWebSource(
      `globalThis.__webProbeExecuted=true;let p='/v2';p=runtime();http({url:p+'/exam',method:'get'}); const fake={path:'/file',size:1};`,
      bundleUrl,
    );
    expect((globalThis as any).__webProbeExecuted).toBeUndefined();
    expect(result.findings.some((f) => f.path === '/v2/exam')).toBe(false);
    expect(result.findings.some((f) => f.kind === 'route')).toBe(false);
  });

  it('reconstructs Webpack chunk filenames from literal manifests without hardcoded releases', () => {
    const result = analyzeWebSource(
      `r.p='https://fe-static-yuketang.yuketang.cn/fe/static/web/9.9/';r.u=function(e){return 'js/'+({12:'subject',34:'exercise'}[e]||e)+'.'+{12:'aabb',34:'ccdd'}[e]+'.js'}`,
      bundleUrl,
    );
    expect(result.assets).toEqual([
      {
        url: 'https://fe-static-yuketang.yuketang.cn/fe/static/web/9.9/js/subject.aabb.js',
        discoveredBy: 'webpack',
      },
      {
        url: 'https://fe-static-yuketang.yuketang.cn/fe/static/web/9.9/js/exercise.ccdd.js',
        discoveredBy: 'webpack',
      },
    ]);
  });

  it('reports unsupported/malformed JavaScript rather than fabricating a route table', () => {
    const result = analyzeWebSource('<html>login</html>', bundleUrl);
    expect(result.findings).toEqual([]);
    expect(result.warnings[0]).toContain('脚本解析失败');
  });
});

function setup(source = `const routes=[{path:'/exercise/:id',component:C}];`) {
  const fetch = vi.fn(
    async () =>
      new Response(source, {
        headers: { 'content-type': 'application/javascript' },
      }),
  );
  const page: WebProbePage = {
    url: pageUrl,
    assets: [{ url: bundleUrl, discoveredBy: 'page' }],
    fetch,
    authorization: vi.fn(async () => 'test-credential'),
  };
  const recorder = new NetworkRecorder();
  const analyze = vi.fn(async (body: string, url: string) =>
    analyzeWebSource(body, url),
  );
  const controller = new WebProbeController(
    async () => page,
    () => recorder.entries,
    analyze,
  );
  return { controller, page, fetch, recorder, analyze };
}

describe('web probe controller', () => {
  it('discovers dynamically, deduplicates scripts, searches context, and exports provenance', async () => {
    const { controller, page, fetch } = setup();
    page.assets.push({ url: bundleUrl, discoveredBy: 'loaded' });
    const report = await controller.scan();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      redirect: 'manual',
      method: 'GET',
    });
    expect(report.assets[0]).toMatchObject({
      status: 'analyzed',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(report.findings[0]?.path).toBe('/exercise/:id');
    expect(controller.search('exercise')[0]).toMatchObject({
      sourceUrl: bundleUrl,
      line: 1,
      offset: 22,
    });
    expect(JSON.stringify(report)).not.toContain('test-credential');
  });

  it('keeps discovered lazy chunks pending until explicitly analyzed', async () => {
    const { controller, fetch } = setup(
      `const routes=[{path:'/exercise',component:()=>import('./exercise.abc.js')}];`,
    );
    const report = await controller.scan();
    expect(fetch).toHaveBeenCalledOnce();
    const lazy = report.assets.find(
      (asset) => asset.discoveredBy === 'import',
    )!;
    expect(lazy.status).toBe('pending');
    await controller.analyzeAsset(lazy.url);
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(
      controller.analyzeAsset('https://pro.yuketang.cn/api/delete'),
    ).rejects.toThrow('已发现');
  });

  it('reuses only same-origin authentication for explicit GET and keeps HTTP/business errors', async () => {
    const { controller, fetch, page } = setup();
    await controller.scan();
    fetch.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            code: 20007,
            token: 'secret-response',
            message: '缺少 uv_id',
          }),
          { status: 403, headers: { 'set-cookie': 'secret-cookie' } },
        ),
    );
    const result = await controller.probe({
      url: '/v/exam/cover?exam_id=1&token=url-secret',
      xtbz: 'ykt',
    });
    expect(fetch.mock.calls.at(-1)?.[1]).toMatchObject({
      method: 'GET',
      credentials: 'include',
      redirect: 'manual',
      headers: { XTBZ: 'ykt', Authorization: 'Bearer test-credential' },
    });
    expect(page.authorization).toHaveBeenCalledOnce();
    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).code).toBe(20007);
    const exported = JSON.stringify(controller.snapshot());
    for (const secret of [
      'secret-response',
      'secret-cookie',
      'url-secret',
      'test-credential',
    ])
      expect(exported).not.toContain(secret);
  });

  it('does not follow API redirects', async () => {
    const { controller, fetch } = setup();
    await controller.scan();
    fetch.mockImplementation(
      async () =>
        new Response('', {
          status: 302,
          headers: { location: 'https://example.org/' },
        }),
    );
    const result = await controller.probe({ url: '/api/redirect' });
    expect(result.statusCode).toBe(302);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    'http://pro.yuketang.cn/a.js',
    'https://pro.yuketang.cn.evil.test/a.js',
    'https://user:pw@pro.yuketang.cn/a.js',
    'https://pro.yuketang.cn:8443/a.js',
    'file:///tmp/a.js',
  ])('rejects unsafe destinations: %s', (url) => {
    expect(() => assertWebProbeUrl(url)).toThrow();
  });

  it('blocks cross-origin probes, unresolved templates, invalid headers, and changed pages', async () => {
    const { controller, page, fetch } = setup();
    await controller.scan();
    await expect(
      controller.probe({ url: 'https://www.yuketang.cn/api/a' }),
    ).rejects.toThrow('同源');
    await expect(
      controller.probe({ url: '/api/{classroom_id}' }),
    ).rejects.toThrow('占位符');
    await expect(
      controller.probe({ url: '/api/a', xtbz: 'x\r\nx:y' }),
    ).rejects.toThrow('无效');
    page.url += '/other';
    await expect(controller.probe({ url: '/api/a' })).rejects.toThrow(
      '页面已变更',
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not download a redirected script from outside Yuketang', async () => {
    const { controller, fetch } = setup();
    fetch.mockImplementation(
      async () =>
        new Response('', {
          status: 302,
          headers: { location: 'https://evil.test/a.js' },
        }),
    );
    const report = await controller.scan();
    expect(fetch).toHaveBeenCalledOnce();
    expect(report.assets[0]?.status).toBe('error');
  });

  it('preserves successes alongside parse and HTTP failures', async () => {
    const { controller, page, fetch } = setup();
    page.assets.push({ url: bundleUrl + '?second', discoveredBy: 'loaded' });
    fetch
      .mockResolvedValueOnce(new Response('broken! js'))
      .mockResolvedValueOnce(
        new Response(`const routes=[{path:'/ok',component:C}];`),
      );
    const report = await controller.scan();
    expect(report.assets.map((a) => a.status)).toEqual(['error', 'analyzed']);
    expect(report.findings.some((f) => f.path === '/ok')).toBe(true);
    expect(report.warnings.join()).toContain('解析失败');
  });

  it('bounds downloads, surfaces truncation, and cancels streams', async () => {
    await expect(readBounded(new Response('123456'), 5)).rejects.toThrow(
      '上限',
    );
    expect(await readBounded(new Response('123456'), 5, true)).toEqual({
      text: '12345',
      bytes: 5,
      truncated: true,
    });
  });

  it('stops active scans and accepts a later scan', async () => {
    const { controller, page } = setup();
    page.fetch = async (_url, options) =>
      new Promise((_resolve, reject) =>
        options.signal?.addEventListener(
          'abort',
          () => reject(options.signal?.reason),
          { once: true },
        ),
      );
    const pending = controller.scan();
    await vi.waitFor(() =>
      expect(controller.snapshot()?.assets.length).toBe(1),
    );
    await expect(controller.scan()).rejects.toThrow('正在进行');
    controller.cancel();
    await expect(pending).rejects.toThrow('停止');
    page.fetch = async () => new Response('const routes=[];');
    await expect(controller.scan()).resolves.toMatchObject({ version: 1 });
  });
});
