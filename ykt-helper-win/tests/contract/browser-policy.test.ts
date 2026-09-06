import { BrowserEnvironment } from '@ykt/contracts';
import { describe, expect, it } from 'vitest';

import {
  environmentForUrl,
  isAllowedYuketangUrl,
  isClassroomUrl,
  resolveYuketangNavigation,
  targetForEnvironment,
} from '../../apps/desktop/main/browser-policy.js';

describe('embedded browser policy', () => {
  it.each([
    'https://www.yuketang.cn/web',
    'https://pro.yuketang.cn/web',
    'https://changjiang.yuketang.cn/v2/web/index',
    'https://school.yuketang.cn/',
  ])('allows Yuketang HTTPS navigation: %s', (url) => {
    expect(isAllowedYuketangUrl(url)).toBe(true);
  });

  it.each([
    'http://www.yuketang.cn/web',
    'https://yuketang.cn.example.com/',
    'file:///C:/Windows/System32/config',
    'javascript:alert(1)',
    'not a url',
  ])('rejects navigation outside the trusted origin: %s', (url) => {
    expect(isAllowedYuketangUrl(url)).toBe(false);
  });

  it('maps the three environment entry points', () => {
    expect(targetForEnvironment(BrowserEnvironment.Changjiang).startUrl).toBe(
      'https://changjiang.yuketang.cn/web',
    );
    expect(environmentForUrl('https://pro.yuketang.cn/v2/web/index')).toBe(
      BrowserEnvironment.Pro,
    );
  });

  it('recognizes only classroom routes for the screen wake lock', () => {
    expect(
      isClassroomUrl('https://pro.yuketang.cn/lesson/fullscreen/v3/123'),
    ).toBe(true);
    expect(
      isClassroomUrl('https://www.yuketang.cn/m/v2/lesson/student/123'),
    ).toBe(true);
    expect(isClassroomUrl('https://pro.yuketang.cn/web')).toBe(false);
  });

  it('resolves address bar input without leaving Yuketang', () => {
    expect(
      resolveYuketangNavigation(
        'pro.yuketang.cn/web',
        'https://pro.yuketang.cn/lesson/1',
      ),
    ).toBe('https://pro.yuketang.cn/web');
    expect(
      resolveYuketangNavigation('/web', 'https://pro.yuketang.cn/lesson/1'),
    ).toBe('https://pro.yuketang.cn/web');
    expect(() =>
      resolveYuketangNavigation(
        'https://example.com',
        'https://pro.yuketang.cn/web',
      ),
    ).toThrow('只能打开雨课堂 HTTPS 地址');
  });
});
