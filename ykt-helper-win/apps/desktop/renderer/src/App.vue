<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  BrowserEnvironment,
  BrowserTargets,
  type BrowserState,
  type RuntimeStatus,
} from '@ykt/contracts';

const runtimeStatus = ref<RuntimeStatus>();
const browserState = ref<BrowserState>();
const controlError = ref('');
let unsubscribe: (() => void) | undefined;

const pageStatus = computed(() => {
  if (browserState.value?.errorMessage) return browserState.value.errorMessage;
  if (browserState.value?.loading) return '正在加载';
  return '页面就绪';
});

onMounted(async () => {
  unsubscribe = window.yuketang.onBrowserStateChanged((state) => {
    browserState.value = state;
    controlError.value = '';
  });

  try {
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
  <header class="browser-chrome">
    <div class="command-row">
      <div class="brand">
        <span class="brand-mark">雨</span>
        <span>雨课堂助手</span>
      </div>

      <nav class="navigation" aria-label="浏览器导航">
        <button
          type="button"
          title="后退"
          :disabled="!browserState?.canGoBack"
          @click="goBack"
        >
          ←
        </button>
        <button
          type="button"
          title="前进"
          :disabled="!browserState?.canGoForward"
          @click="goForward"
        >
          →
        </button>
        <button type="button" title="刷新" @click="reload">↻</button>
      </nav>

      <label class="environment-picker">
        <span>服务器</span>
        <select
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

      <div class="runtime-state" :class="runtimeStatus?.state">
        <span class="status-dot" />
        <span>Backend {{ runtimeStatus?.state ?? 'connecting' }}</span>
      </div>
    </div>

    <div class="address-row">
      <span class="security-mark" title="仅允许雨课堂 HTTPS 页面">⌾</span>
      <span class="address" :title="browserState?.url">
        {{ browserState?.url || '正在打开雨课堂…' }}
      </span>
      <span
        class="page-status"
        :class="{
          loading: browserState?.loading,
          error: browserState?.errorMessage || controlError,
        }"
      >
        {{ controlError || pageStatus }}
      </span>
    </div>
  </header>

  <main class="browser-placeholder">
    <p>正在初始化安全网页容器…</p>
  </main>
</template>
