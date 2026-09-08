export const BrowserEnvironment = {
  Standard: 'standard',
  Pro: 'pro',
  Changjiang: 'changjiang',
} as const;

export type BrowserEnvironment =
  (typeof BrowserEnvironment)[keyof typeof BrowserEnvironment];

export interface BrowserTarget {
  id: BrowserEnvironment;
  label: string;
  startUrl: string;
}

export const BrowserTargets: readonly BrowserTarget[] = [
  {
    id: BrowserEnvironment.Standard,
    label: '雨课堂',
    startUrl: 'https://www.yuketang.cn/web',
  },
  {
    id: BrowserEnvironment.Pro,
    label: '荷塘雨课堂',
    startUrl: 'https://pro.yuketang.cn/web',
  },
  {
    id: BrowserEnvironment.Changjiang,
    label: '长江雨课堂',
    startUrl: 'https://changjiang.yuketang.cn/web',
  },
];

export interface BrowserTabState {
  id: string;
  environment: BrowserEnvironment;
  url: string;
  title: string;
  loading: boolean;
}

export interface BrowserState {
  tabs: readonly BrowserTabState[];
  activeTabId: string;
  environment: BrowserEnvironment;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  errorMessage: string | null;
}

export function isBrowserEnvironment(
  value: unknown,
): value is BrowserEnvironment {
  return BrowserTargets.some((target) => target.id === value);
}
