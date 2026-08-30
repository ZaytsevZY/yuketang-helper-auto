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
