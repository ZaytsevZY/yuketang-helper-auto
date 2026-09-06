import {
  BrowserTargets,
  type BrowserEnvironment,
  type BrowserTarget,
} from '@ykt/contracts';

export function isAllowedYuketangUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'yuketang.cn' || url.hostname.endsWith('.yuketang.cn'))
    );
  } catch {
    return false;
  }
}

export function isClassroomUrl(value: string): boolean {
  try {
    return /\/lesson\/fullscreen\/v3(?:\/|$)|\/v2\/web\/lesson(?:\/|$)|\/m\/v2(?:\/|$)/.test(
      new URL(value).pathname,
    );
  } catch {
    return false;
  }
}

export function targetForEnvironment(
  environment: BrowserEnvironment,
): BrowserTarget {
  const target = BrowserTargets.find((item) => item.id === environment);
  if (!target) throw new Error(`Unknown browser environment: ${environment}`);
  return target;
}

export function environmentForUrl(
  value: string,
): BrowserEnvironment | undefined {
  try {
    const hostname = new URL(value).hostname;
    return BrowserTargets.find(
      (target) => new URL(target.startUrl).hostname === hostname,
    )?.id;
  } catch {
    return undefined;
  }
}

export function resolveYuketangNavigation(
  value: string,
  currentUrl: string,
): string {
  const input = value.trim();
  if (!input) throw new Error('请输入雨课堂网址');

  let url: URL;
  try {
    if (/^[\w-]+(?:\.[\w-]+)+(?:\/|$)/.test(input)) {
      url = new URL(`https://${input}`);
    } else {
      url = new URL(input, currentUrl);
    }
  } catch {
    throw new Error('网址格式不正确');
  }
  if (!isAllowedYuketangUrl(url.toString())) {
    throw new Error('只能打开雨课堂 HTTPS 地址');
  }
  return url.toString();
}
