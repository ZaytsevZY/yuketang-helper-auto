<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type {
  DomainNetworkEntry,
  NetworkCaptureState,
  NetworkEntry,
} from '@ykt/contracts';

type EntryFilter = 'all' | NetworkEntry['kind'];

const entries = ref<NetworkEntry[]>([]);
const captureState = ref<NetworkCaptureState>({
  paused: false,
  deepCapture: false,
  deepCaptureAvailable: true,
  deepCaptureError: null,
  entryCount: 0,
  droppedEntries: 0,
});
const filter = ref<EntryFilter>('all');
const search = ref('');
const selectedId = ref<string>();
const message = ref('');
const collapsed = ref(false);
const subscriptions: Array<() => void> = [];

const filteredEntries = computed(() => {
  const query = search.value.trim().toLowerCase();
  return entries.value.filter((entry) => {
    if (filter.value !== 'all' && entry.kind !== filter.value) return false;
    return !query || JSON.stringify(entry).toLowerCase().includes(query);
  });
});

const selectedEntry = computed(() =>
  entries.value.find((entry) => entry.id === selectedId.value),
);

const relatedDomainEvents = computed(() => {
  const selected = selectedEntry.value;
  if (!selected) return [];
  if (selected.kind === 'domain') return [selected];
  return entries.value.filter(
    (entry): entry is DomainNetworkEntry =>
      entry.kind === 'domain' && entry.sourceEntryId === selected.id,
  );
});

onMounted(async () => {
  subscriptions.push(
    window.yuketang.onNetworkEntryAdded((entry) => {
      entries.value.push(entry);
      if (entries.value.length > 1_000) entries.value.shift();
      if (!selectedId.value) selectedId.value = entry.id;
    }),
    window.yuketang.onNetworkCaptureStateChanged((state) => {
      captureState.value = state;
    }),
  );

  try {
    const snapshot = await window.yuketang.getNetworkSnapshot();
    entries.value = [...snapshot.entries];
    captureState.value = snapshot.state;
    selectedId.value = entries.value.at(-1)?.id;
  } catch {
    message.value = '无法连接网络观察器';
  }
});

onUnmounted(() => subscriptions.forEach((unsubscribe) => unsubscribe()));

async function togglePaused(): Promise<void> {
  await runAction(() =>
    window.yuketang.setNetworkPaused(!captureState.value.paused),
  );
}

async function toggleDeepCapture(event: Event): Promise<void> {
  const enabled = (event.target as HTMLInputElement).checked;
  await runAction(() => window.yuketang.setDeepCapture(enabled));
}

async function clearEntries(): Promise<void> {
  await runAction(async () => {
    await window.yuketang.clearNetworkEntries();
    entries.value = [];
    selectedId.value = undefined;
  });
}

async function exportFixture(): Promise<void> {
  await runAction(async () => {
    const result = await window.yuketang.exportNetworkFixture();
    if (result) message.value = `已导出：${result.filePath}`;
  });
}

async function toggleCollapsed(): Promise<void> {
  const next = !collapsed.value;
  collapsed.value = next;
  try {
    await window.yuketang.setNetworkLabCollapsed(next);
  } catch (error) {
    collapsed.value = !next;
    message.value =
      error instanceof Error
        ? `无法调整网络实验室面板：${error.message}`
        : '无法调整网络实验室面板';
  }
}

async function runAction(action: () => Promise<void>): Promise<void> {
  try {
    message.value = '';
    await action();
  } catch {
    message.value = '网络实验室操作失败';
  }
}

function entryTitle(entry: NetworkEntry): string {
  if (entry.kind === 'http') {
    return `${entry.method} ${shortUrl(entry.url)}`;
  }
  if (entry.kind === 'websocket') {
    return `${entry.direction.toUpperCase()} ${shortUrl(entry.url)}`;
  }
  return entry.eventType;
}

function entryMeta(entry: NetworkEntry): string {
  if (entry.kind === 'http') {
    return `${entry.source} · ${entry.statusCode ?? '—'} · ${entry.durationMs ?? '—'} ms · ${entry.resourceType}`;
  }
  if (entry.kind === 'websocket')
    return `${entry.source} · WS · ${entry.requestId}`;
  return `${entry.source} · DOMAIN · ${entry.normalizerId}`;
}

function shortUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return value || '(unknown)';
  }
}
</script>

<template>
  <section class="network-lab" :class="{ collapsed }">
    <header class="lab-toolbar">
      <strong>网络实验室</strong>
      <div v-if="!collapsed" class="filters" aria-label="记录类型">
        <button
          v-for="item in ['all', 'http', 'websocket', 'domain'] as const"
          :key="item"
          type="button"
          :class="{ active: filter === item }"
          @click="filter = item"
        >
          {{
            item === 'all'
              ? '全部'
              : item === 'websocket'
                ? 'WS'
                : item.toUpperCase()
          }}
        </button>
      </div>
      <input
        v-if="!collapsed"
        v-model="search"
        class="search"
        type="search"
        placeholder="搜索 URL / payload"
      />
      <label
        v-if="!collapsed"
        class="deep-toggle"
        :title="captureState.deepCaptureError ?? '捕获响应正文和 WebSocket 帧'"
      >
        <input
          type="checkbox"
          :checked="captureState.deepCapture"
          :disabled="!captureState.deepCaptureAvailable"
          @change="toggleDeepCapture"
        />
        深度捕获
      </label>
      <button v-if="!collapsed" type="button" @click="togglePaused">
        {{ captureState.paused ? '继续' : '暂停' }}
      </button>
      <button v-if="!collapsed" type="button" @click="clearEntries">
        清空
      </button>
      <button v-if="!collapsed" type="button" @click="exportFixture">
        导出
      </button>
      <span class="lab-count">
        {{ entries.length }} 条<span v-if="captureState.droppedEntries">
          · 丢弃 {{ captureState.droppedEntries }}</span
        >
      </span>
      <button
        type="button"
        class="collapse-toggle"
        :aria-expanded="!collapsed"
        :title="collapsed ? '展开网络实验室' : '收起网络实验室'"
        @click="toggleCollapsed"
      >
        {{ collapsed ? '展开' : '收起' }}
      </button>
    </header>

    <div v-if="!collapsed" class="lab-body">
      <div class="entry-list">
        <button
          v-for="entry in filteredEntries"
          :key="entry.id"
          type="button"
          class="entry-row"
          :class="[entry.kind, { selected: selectedId === entry.id }]"
          @click="selectedId = entry.id"
        >
          <span class="entry-kind">{{
            entry.kind === 'websocket'
              ? 'WS'
              : entry.kind.slice(0, 4).toUpperCase()
          }}</span>
          <span class="entry-main">
            <strong>{{ entryTitle(entry) }}</strong>
            <small>{{ entryMeta(entry) }}</small>
          </span>
        </button>
        <p v-if="filteredEntries.length === 0" class="empty">等待网络记录…</p>
      </div>

      <div class="detail-pane">
        <section>
          <h3>原始记录（已脱敏）</h3>
          <pre>{{
            selectedEntry
              ? JSON.stringify(selectedEntry, null, 2)
              : '选择一条记录查看详情'
          }}</pre>
        </section>
        <section>
          <h3>解析结果</h3>
          <pre>{{
            relatedDomainEvents.length
              ? JSON.stringify(relatedDomainEvents, null, 2)
              : '尚未映射为领域事件'
          }}</pre>
        </section>
      </div>
    </div>

    <p
      v-if="!collapsed && (captureState.deepCaptureError || message)"
      class="lab-message"
    >
      {{ message || captureState.deepCaptureError }}
    </p>
  </section>
</template>

<style scoped>
.network-lab {
  position: fixed;
  z-index: 3;
  right: 0;
  bottom: 0;
  left: 0;
  right: var(--assistant-width);
  height: 300px;
  border-top: 1px solid var(--line-strong);
  background: var(--surface-subtle);
  color: var(--text);
}

.network-lab.collapsed {
  height: 43px;
}

.network-lab.collapsed .lab-toolbar {
  border-bottom: 0;
}

.lab-toolbar {
  display: flex;
  height: 43px;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
  overflow-x: auto;
}

.lab-toolbar strong {
  margin-right: 4px;
  white-space: nowrap;
}

.lab-toolbar button,
.filters button {
  height: 27px;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  background: #fff;
  color: var(--text);
  cursor: pointer;
}

.lab-toolbar .collapse-toggle {
  min-width: 62px;
  border-color: #9fc6ae;
  background: var(--green-soft);
  color: var(--green-strong);
}

.filters {
  display: flex;
}

.filters button {
  border-radius: 0;
  border-right-width: 0;
}

.filters button:first-child {
  border-radius: 5px 0 0 5px;
}

.filters button:last-child {
  border-right-width: 1px;
  border-radius: 0 5px 5px 0;
}

.filters button.active {
  border-color: var(--green);
  background: var(--green-soft);
  color: var(--green-strong);
}

.search {
  width: min(260px, 24vw);
  height: 28px;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  outline: none;
  padding: 0 8px;
  font: inherit;
}

.search:focus {
  border-color: var(--green);
  box-shadow: 0 0 0 3px rgb(8 138 87 / 14%);
}

.deep-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.lab-count {
  margin-left: auto;
  color: var(--text-muted);
  white-space: nowrap;
}

.lab-body {
  display: grid;
  height: 256px;
  grid-template-columns: minmax(300px, 38%) 1fr;
}

.entry-list {
  overflow: auto;
  border-right: 1px solid var(--line);
  background: #fff;
}

.entry-row {
  display: flex;
  width: 100%;
  min-height: 48px;
  align-items: center;
  gap: 8px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: #fff;
  padding: 6px 10px;
  text-align: left;
  cursor: pointer;
}

.entry-row:hover,
.entry-row.selected {
  background: var(--green-soft);
}

.entry-kind {
  width: 42px;
  flex: 0 0 auto;
  color: var(--green-strong);
  font-size: 10px;
  font-weight: 700;
}

.entry-row.websocket .entry-kind {
  color: #6f55ae;
}

.entry-row.domain .entry-kind {
  color: #a26718;
}

.entry-main {
  min-width: 0;
}

.entry-main strong,
.entry-main small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-main strong {
  font-size: 11px;
  font-weight: 600;
}

.entry-main small {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 10px;
}

.detail-pane {
  display: grid;
  min-width: 0;
  grid-template-columns: 1fr 1fr;
}

.detail-pane section {
  display: flex;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
}

.detail-pane section + section {
  border-left: 1px solid var(--line);
}

.detail-pane h3 {
  height: 30px;
  margin: 0;
  padding: 8px 10px 0;
  font-size: 11px;
  font-weight: 600;
}

.detail-pane pre {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 6px 10px 12px;
  color: #4b5851;
  font-family: Consolas, monospace;
  font-size: 10px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
}

.empty {
  margin: 32px 0;
  color: var(--text-muted);
  text-align: center;
  font-size: 12px;
}

.lab-message {
  position: absolute;
  right: 12px;
  bottom: 8px;
  max-width: 50%;
  overflow: hidden;
  margin: 0;
  border-radius: 4px;
  background: #fff2dc;
  padding: 4px 7px;
  color: #8a5c12;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 680px) {
  .network-lab {
    display: none;
  }
}

.entry-kind,
.entry-main strong,
.entry-main small,
.detail-pane h3,
.detail-pane pre,
.lab-message {
  font-size: 12px;
}
</style>
