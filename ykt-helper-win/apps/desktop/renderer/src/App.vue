<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  BrowserEnvironment,
  BrowserTargets,
  type BrowserState,
  type RuntimeStatus,
} from '@ykt/contracts';

import AssistantPanel from './components/AssistantPanel.vue';
import NetworkLab from './components/NetworkLab.vue';

type WorkspacePage =
  | 'classroom'
  | 'problems'
  | 'ai'
  | 'courseware'
  | 'profiles'
  | 'settings'
  | 'diagnostics';

const pages: ReadonlyArray<{ id: WorkspacePage; label: string }> = [
  { id: 'classroom', label: '课堂' },
  { id: 'problems', label: '题目' },
  { id: 'ai', label: 'AI' },
  { id: 'courseware', label: '课件' },
  { id: 'profiles', label: '模型' },
  { id: 'settings', label: '设置' },
  { id: 'diagnostics', label: '诊断' },
];

const runtimeStatus = ref<RuntimeStatus>();
const browserState = ref<BrowserState>();
const activePage = ref<WorkspacePage>('classroom');
const initiallyCollapsed = window.matchMedia('(max-width: 680px)').matches;
const assistantCollapsed = ref(initiallyCollapsed);
const controlError = ref('');
let unsubscribe: (() => void) | undefined;

const pageStatus = computed(() => {
  if (browserState.value?.errorMessage) return browserState.value.errorMessage;
  if (browserState.value?.loading) return '正在加载';
  return '页面就绪';
});

const shellStyle = computed(() => ({
  '--assistant-width': assistantCollapsed.value ? '44px' : '380px',
}));

onMounted(async () => {
  unsubscribe = window.yuketang.onBrowserStateChanged((state) => {
    browserState.value = state;
    controlError.value = '';
  });

  try {
    if (initiallyCollapsed) {
      await window.yuketang.setAssistantPanelCollapsed(true);
    }
    [runtimeStatus.value, browserState.value] = await Promise.all([
      window.yuketang.getRuntimeStatus(),
      window.yuketang.getBrowserState(),
    ]);
  } catch {
    controlError.value = '无法连接桌面主进程';
  }
});

onUnmounted(() => unsubscribe?.());

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
  const next = !assistantCollapsed.value;
  assistantCollapsed.value = next;
  try {
    await window.yuketang.setAssistantPanelCollapsed(next);
  } catch {
    assistantCollapsed.value = !next;
    controlError.value = '无法调整助手面板';
  }
}

function selectPage(page: WorkspacePage): void {
  activePage.value = page;
  if (assistantCollapsed.value) void toggleAssistant();
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
</script>

<template>
  <div
    class="desktop-shell"
    :class="{ 'assistant-is-collapsed': assistantCollapsed }"
    :style="shellStyle"
  >
    <header class="browser-chrome">
      <div class="browser-row">
        <div class="brand" aria-label="雨课堂助手">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img">
              <path
                d="M4 5.5 10.6 3v16.2L4 21.5V5.5Zm8 0L18.5 3v16L12 21.5v-16ZM7 7.2v9.6M15.2 6.6v9.8"
              />
            </svg>
          </span>
          <span>雨课堂助手</span>
        </div>

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
        </nav>

        <div class="address-bar">
          <svg class="lock-mark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" />
          </svg>
          <span :title="browserState?.url">
            {{ browserState?.url || '正在打开雨课堂…' }}
          </span>
        </div>
      </div>

      <div class="task-row">
        <label class="environment-picker">
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
        </label>

        <nav class="task-navigation" aria-label="助手功能">
          <button
            v-for="page in pages"
            :key="page.id"
            type="button"
            :class="{ active: activePage === page.id }"
            :aria-current="activePage === page.id ? 'page' : undefined"
            @click="selectPage(page.id)"
          >
            {{ page.label }}
          </button>
        </nav>

        <div class="runtime-state" :class="runtimeStatus?.state">
          <span class="status-dot" aria-hidden="true" />
          <span>{{ controlError || pageStatus }}</span>
          <span class="runtime-label"
            >Backend {{ runtimeStatus?.state ?? 'connecting' }}</span
          >
        </div>
      </div>
    </header>

    <main class="browser-placeholder" aria-hidden="true">
      <div>
        <strong>正在初始化安全网页容器</strong>
        <span>真实雨课堂页面将在这里显示</span>
      </div>
    </main>

    <AssistantPanel
      :page="activePage"
      :environment="browserState?.environment ?? BrowserEnvironment.Standard"
      :runtime="runtimeStatus"
      :browser-url="browserState?.url"
      :collapsed="assistantCollapsed"
      @toggle="toggleAssistant"
      @select-page="selectPage"
    />
    <NetworkLab />
  </div>
</template>
