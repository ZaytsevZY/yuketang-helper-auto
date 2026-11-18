<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  BrowserEnvironment,
  BrowserTargets,
  isToolPanelId,
  type ToolPanelId,
  type BrowserState,
  type RuntimeStatus,
  type WebAreaBounds,
} from '@ykt/contracts';

import ToolWorkspace from './components/ToolWorkspace.vue';
import { toolLabels } from './tool-catalog';

const runtimeStatus = ref<RuntimeStatus>();
const profileAvailable = ref<boolean | null>(null);
const browserState = ref<BrowserState>();
const route =
  window.location.hash === '#tools'
    ? 'tools'
    : window.location.hash.replace(/^#panel=/, '');
const panelId = isToolPanelId(route) ? route : undefined;
const assistantCollapsed = ref(true);
const networkCollapsed = ref(true);
const profileChannel =
  typeof window.BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('ykt-profile-status');
if (profileChannel)
  profileChannel.onmessage = (event) => {
    if (typeof event.data === 'boolean') profileAvailable.value = event.data;
  };
const controlError = ref('');
const addressDraft = ref('');
const editingAddress = ref(false);
const webArea = ref<HTMLElement | null>(null);
let unsubscribe: (() => void) | undefined;
let resizeObserver: ResizeObserver | undefined;
let lastBoundsKey = '';

const pageStatus = computed(() => {
  if (browserState.value?.errorMessage) return browserState.value.errorMessage;
  if (browserState.value?.loading) return '正在加载';
  return '页面就绪';
});

const toolsVisible = computed(
  () =>
    browserState.value?.panels?.some(
      (panel) => panel.id === 'tools' && panel.visible,
    ) ?? !assistantCollapsed.value,
);
const openedPanels = computed(
  () =>
    browserState.value?.panels?.filter(
      (panel) => panel.visible && panel.id !== 'tools',
    ) ?? [],
);
async function openPanel(id: ToolPanelId): Promise<void> {
  await runControl(() =>
    window.yuketang.controlToolPanel({ action: 'open', id }),
  );
}
function reportWebAreaBounds(): void {
  const element = webArea.value;
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const bounds: WebAreaBounds = {
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top)),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  };
  const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
  if (key === lastBoundsKey) return;
  lastBoundsKey = key;
  void window.yuketang.setWebAreaBounds(bounds).catch(() => {
    lastBoundsKey = '';
  });
}

onMounted(async () => {
  if (panelId) return;
  resizeObserver = new ResizeObserver(() => reportWebAreaBounds());
  if (webArea.value) resizeObserver.observe(webArea.value);

  unsubscribe = window.yuketang.onBrowserStateChanged((state) => {
    browserState.value = state;
    assistantCollapsed.value = state.assistantPanelCollapsed;
    networkCollapsed.value = state.networkLabCollapsed;
    if (!editingAddress.value) addressDraft.value = state.url;
    controlError.value = '';
  });

  try {
    [runtimeStatus.value, browserState.value] = await Promise.all([
      window.yuketang.getRuntimeStatus(),
      window.yuketang.getBrowserState(),
    ]);
    assistantCollapsed.value = browserState.value.assistantPanelCollapsed;
    networkCollapsed.value = browserState.value.networkLabCollapsed;
    addressDraft.value = browserState.value.url;
    reportWebAreaBounds();
  } catch {
    controlError.value = '无法连接桌面主进程';
  }
});

onUnmounted(() => {
  unsubscribe?.();
  resizeObserver?.disconnect();
  profileChannel?.close();
});

async function selectEnvironment(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value;
  if (
    !Object.values(BrowserEnvironment).includes(value as BrowserEnvironment)
  ) {
    return;
  }
  await runControl(() =>
    window.yuketang.selectBrowserEnvironment(value as BrowserEnvironment),
  );
}

async function toggleAssistant(): Promise<void> {
  await runControl(() =>
    window.yuketang.controlToolPanel({
      action: toolsVisible.value ? 'close' : 'open',
      id: 'tools',
    }),
  );
}

async function runControl(action: () => Promise<void>): Promise<void> {
  try {
    controlError.value = '';
    await action();
  } catch {
    controlError.value = '浏览器操作失败';
  }
}

const goBack = () => runControl(() => window.yuketang.browserBack());
const goForward = () => runControl(() => window.yuketang.browserForward());
const reload = () => runControl(() => window.yuketang.browserReload());
const goHome = () => runControl(() => window.yuketang.browserHome());
const newTab = () => runControl(() => window.yuketang.browserNewTab());
const activateTab = (tabId: string) =>
  runControl(() => window.yuketang.browserActivateTab(tabId));
const closeTab = (tabId: string) =>
  runControl(() => window.yuketang.browserCloseTab(tabId));

function beginAddressEdit(event: FocusEvent): void {
  editingAddress.value = true;
  (event.target as HTMLInputElement).select();
}

function finishAddressEdit(): void {
  editingAddress.value = false;
  addressDraft.value = browserState.value?.url ?? addressDraft.value;
}

async function navigateAddress(): Promise<void> {
  try {
    controlError.value = '';
    await window.yuketang.browserNavigate(addressDraft.value);
    editingAddress.value = false;
    addressDraft.value = browserState.value?.url ?? addressDraft.value;
  } catch {
    controlError.value = '网址无效，仅支持雨课堂 HTTPS 地址';
  }
}
</script>

<template>
  <div v-if="!panelId" class="desktop-shell">
    <header class="browser-chrome">
      <div class="tab-row">
        <div class="brand" aria-label="雨课堂助手">
          <span
            v-if="profileAvailable === false"
            class="profile-unavailable"
            role="status"
            >无可用 Profile</span
          >
          <template v-else>
            <span class="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="img">
                <path
                  d="M4 5.5 10.6 3v16.2L4 21.5V5.5Zm8 0L18.5 3v16L12 21.5v-16ZM7 7.2v9.6M15.2 6.6v9.8"
                />
              </svg>
            </span>
            <span>雨课堂助手</span>
          </template>
        </div>

        <div class="tab-strip" role="tablist" aria-label="雨课堂页面">
          <div
            v-for="tab in browserState?.tabs ?? []"
            :key="tab.id"
            class="browser-tab"
            :class="{
              active: tab.id === browserState?.activeTabId,
              loading: tab.loading,
            }"
          >
            <button
              class="tab-activate"
              type="button"
              role="tab"
              :aria-selected="tab.id === browserState?.activeTabId"
              :title="tab.title"
              @click="activateTab(tab.id)"
            >
              <span class="tab-status" aria-hidden="true" />
              <span class="tab-title">{{ tab.title }}</span>
            </button>
            <button
              class="tab-close"
              type="button"
              :aria-label="`删除页面 ${tab.title}`"
              title="删除页面"
              @click="closeTab(tab.id)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m7 7 10 10M17 7 7 17" />
              </svg>
            </button>
          </div>
        </div>

        <button
          class="new-tab-button"
          type="button"
          aria-label="新建标签页"
          title="新建标签页"
          @click="newTab"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <nav
          v-if="openedPanels.length"
          class="open-panels"
          aria-label="已打开的悬浮面板"
        >
          <button
            v-for="panel in openedPanels"
            :key="panel.id"
            type="button"
            :class="{ active: panel.focused }"
            @click="openPanel(panel.id)"
          >
            {{ toolLabels[panel.id] }}
          </button>
        </nav>
      </div>

      <div class="browser-row">
        <nav class="navigation" aria-label="浏览器导航">
          <button
            type="button"
            title="后退"
            aria-label="后退"
            :disabled="!browserState?.canGoBack"
            @click="goBack"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m14.5 6-6 6 6 6" />
            </svg>
          </button>
          <button
            type="button"
            title="前进"
            aria-label="前进"
            :disabled="!browserState?.canGoForward"
            @click="goForward"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m9.5 6 6 6-6 6" />
            </svg>
          </button>
          <button type="button" title="刷新" aria-label="刷新" @click="reload">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 8a8 8 0 1 0 1 5M19 4v4h-4" />
            </svg>
          </button>
          <button type="button" title="主页" aria-label="主页" @click="goHome">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m4 11 8-7 8 7M6.5 9.5V20h11V9.5M10 20v-6h4v6" />
            </svg>
          </button>
        </nav>

        <form class="address-bar" @submit.prevent="navigateAddress">
          <svg class="lock-mark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" />
          </svg>
          <input
            v-model="addressDraft"
            type="text"
            aria-label="网址"
            autocomplete="off"
            spellcheck="false"
            placeholder="输入雨课堂网址"
            @focus="beginAddressEdit"
            @blur="finishAddressEdit"
          />
        </form>
        <div class="environment-picker">
          <span class="environment-status" aria-hidden="true" />
          <select
            aria-label="雨课堂服务器"
            :value="browserState?.environment ?? BrowserEnvironment.Standard"
            @change="selectEnvironment"
          >
            <option
              v-for="target in BrowserTargets"
              :key="target.id"
              :value="target.id"
            >
              {{ target.label }}
            </option>
          </select>
        </div>

        <button
          class="tools-trigger"
          type="button"
          :aria-expanded="toolsVisible"
          @click="toggleAssistant"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="4" width="6" height="6" rx="1.5" />
            <rect x="14" y="4" width="6" height="6" rx="1.5" />
            <rect x="4" y="14" width="6" height="6" rx="1.5" />
            <rect x="14" y="14" width="6" height="6" rx="1.5" />
          </svg>
          工具
        </button>
      </div>
    </header>

    <main ref="webArea" class="browser-placeholder" aria-hidden="true">
      <div>
        <strong>正在打开雨课堂网页…</strong>
      </div>
    </main>

    <p
      v-if="controlError || browserState?.errorMessage"
      class="browser-error"
      role="alert"
    >
      {{ controlError || pageStatus }}
    </p>
  </div>

  <ToolWorkspace v-else :panel-id="panelId" />
</template>
