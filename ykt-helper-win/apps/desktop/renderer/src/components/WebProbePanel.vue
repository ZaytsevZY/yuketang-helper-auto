<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type {
  WebProbeEvidence,
  WebProbeFinding,
  WebProbeReport,
} from '@ykt/contracts';

const report = ref<WebProbeReport | null>(null);
const busy = ref(false);
const message = ref('');
const query = ref('');
const mode = ref<
  'route' | 'api' | 'path' | 'assets' | 'observed' | 'search' | 'probes'
>('route');
const selected = ref<unknown>(null);
const hits = ref<readonly WebProbeEvidence[]>([]);
const requestUrl = ref('');
const xtbz = ref('ykt');
const tabs = [
  ['route', '路由'],
  ['api', '接口'],
  ['path', '路径'],
  ['assets', '脚本'],
  ['observed', '已捕获'],
  ['search', '源码'],
  ['probes', '响应'],
] as const;
const findings = computed(() =>
  (report.value?.findings ?? []).filter(
    (item) => item.kind === mode.value && matches(item),
  ),
);
const assets = computed(() => (report.value?.assets ?? []).filter(matches));
const observed = computed(() => (report.value?.observed ?? []).filter(matches));
const candidate = computed(() => {
  const value = selected.value as Partial<WebProbeFinding> | null;
  return value?.path &&
    value.kind !== 'route' &&
    (!value.method || value.method === 'GET')
    ? value.path
    : null;
});
function matches(value: unknown): boolean {
  return (
    !query.value.trim() ||
    JSON.stringify(value)
      .toLowerCase()
      .includes(query.value.trim().toLowerCase())
  );
}
onMounted(() =>
  run(async () => {
    report.value = await window.yuketang.getWebProbeReport();
  }),
);

async function run(action: () => Promise<void>): Promise<void> {
  busy.value = true;
  message.value = '';
  try {
    await action();
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Web 探测失败';
    report.value = await window.yuketang
      .getWebProbeReport()
      .catch(() => report.value);
  } finally {
    busy.value = false;
  }
}
async function scan(): Promise<void> {
  selected.value = null;
  hits.value = [];
  await run(async () => {
    report.value = await window.yuketang.scanWebPage();
  });
}
async function analyze(url: string): Promise<void> {
  await run(async () => {
    report.value = await window.yuketang.analyzeWebAsset(url);
    selected.value = report.value.assets.find((item) => item.url === url);
  });
}
async function searchSources(): Promise<void> {
  await run(async () => {
    hits.value = await window.yuketang.searchWebSources(query.value);
    mode.value = 'search';
    selected.value = hits.value[0] ?? null;
  });
}
async function probe(): Promise<void> {
  await run(async () => {
    selected.value = await window.yuketang.probeWebGet({
      url: requestUrl.value,
      xtbz: xtbz.value,
    });
    report.value = await window.yuketang.getWebProbeReport();
    mode.value = 'probes';
  });
}
async function exportReport(): Promise<void> {
  await run(async () => {
    const result = await window.yuketang.exportWebProbe();
    if (result) message.value = `已导出：${result.filePath}`;
  });
}
async function cancel(): Promise<void> {
  try {
    await window.yuketang.cancelWebProbe();
  } catch {
    message.value = '停止失败';
  }
}
function detail(value: unknown): string {
  if (
    value &&
    typeof value === 'object' &&
    'body' in value &&
    typeof value.body === 'string'
  ) {
    try {
      return JSON.stringify(
        { ...value, body: JSON.parse(value.body) },
        null,
        2,
      );
    } catch {
      /* Text/partial responses stay visible. */
    }
  }
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
const evidence = computed(() => {
  const value = selected.value as {
    evidence?: WebProbeEvidence;
    snippet?: string;
  } | null;
  return (
    value?.evidence ?? (value?.snippet ? (value as WebProbeEvidence) : null)
  );
});
</script>

<template>
  <div class="web-probe">
    <div class="probe-toolbar">
      <button :disabled="busy" @click="scan">
        {{ busy ? '探测中…' : '分析当前页面' }}
      </button>
      <button v-if="busy" @click="cancel">停止</button>
      <button :disabled="busy || !report" @click="exportReport">
        导出报告
      </button>
      <input
        v-model="query"
        aria-label="探测关键词"
        placeholder="筛选 / 搜索源码关键词"
        @keyup.enter="searchSources"
      />
      <button
        :disabled="busy || !report || query.trim().length < 2"
        @click="searchSources"
      >
        搜索源码
      </button>
      <span v-if="report" class="count"
        >{{ report.assets.filter((a) => a.status === 'analyzed').length }}/{{
          report.assets.length
        }}
        脚本 · {{ report.findings.length }} 候选</span
      >
    </div>
    <div class="probe-content">
      <div class="catalog">
        <nav aria-label="Web 探测分类">
          <button
            v-for="[key, label] in tabs"
            :key="key"
            :class="{ active: mode === key }"
            @click="mode = key"
          >
            {{ label }}
          </button>
        </nav>
        <div class="rows">
          <template v-if="['route', 'api', 'path'].includes(mode)">
            <button
              v-for="(item, index) in findings"
              :key="index"
              class="row"
              @click="selected = item"
            >
              <strong
                >{{ item.method ? `${item.method} ` : ''
                }}{{ item.path }}</strong
              >
              <small
                >{{ item.name ?? '源码候选' }} · {{ item.evidence.line }}:{{
                  item.evidence.column
                }}</small
              >
            </button>
            <p v-if="!findings.length" class="empty">
              {{ report ? '暂无匹配候选' : '尚未分析页面' }}
            </p>
          </template>
          <template v-else-if="mode === 'assets'">
            <div v-for="asset in assets" :key="asset.url" class="asset-row">
              <button class="row" @click="selected = asset">
                <strong>{{ asset.url }}</strong
                ><small
                  >{{
                    asset.status === 'analyzed'
                      ? '已分析'
                      : asset.status === 'error'
                        ? '失败'
                        : '待分析'
                  }}
                  · {{ asset.discoveredBy
                  }}{{
                    asset.bytes !== null
                      ? ` · ${Math.round(asset.bytes / 1024)} KiB`
                      : ''
                  }}</small
                >
              </button>
              <button
                v-if="asset.status !== 'analyzed'"
                :disabled="busy"
                @click="analyze(asset.url)"
              >
                分析
              </button>
            </div>
          </template>
          <template v-else-if="mode === 'observed'">
            <button
              v-for="(item, index) in observed"
              :key="index"
              class="row"
              @click="
                selected = item;
                requestUrl = item.method === 'GET' ? item.url : requestUrl;
              "
            >
              <strong>{{ item.method }} {{ item.url }}</strong
              ><small>HTTP {{ item.statusCode ?? '—' }}</small>
            </button>
          </template>
          <template v-else-if="mode === 'search'">
            <button
              v-for="(hit, index) in hits"
              :key="index"
              class="row"
              @click="selected = hit"
            >
              <strong>{{ hit.sourceUrl }}</strong
              ><small
                >{{ hit.line }}:{{ hit.column }} ·
                {{ hit.snippet.slice(0, 100) }}</small
              >
            </button>
            <p v-if="!hits.length" class="empty">暂无源码匹配</p>
          </template>
          <template v-else>
            <button
              v-for="(item, index) in report?.probes ?? []"
              :key="index"
              class="row"
              @click="selected = item"
            >
              <strong>{{ item.statusCode }} {{ item.url }}</strong
              ><small
                >{{ item.durationMs }} ms · {{ item.timestamp
                }}{{ item.truncated ? ' · 正文已截断' : '' }}</small
              >
            </button>
          </template>
        </div>
      </div>
      <div class="probe-detail">
        <form class="request-form" @submit.prevent="probe">
          <input
            v-model="requestUrl"
            aria-label="GET 接口地址"
            placeholder="GET /接口路径?参数=值"
            required
          />
          <input
            v-model="xtbz"
            class="xtbz"
            aria-label="XTBZ"
            title="XTBZ"
            placeholder="XTBZ"
            required
          />
          <button :disabled="busy || !report || !requestUrl.trim()">
            GET 探测
          </button>
        </form>
        <button v-if="candidate" class="fill" @click="requestUrl = candidate!">
          填入 GET 地址
        </button>
        <div v-if="evidence" class="source-detail">
          <small
            >{{ evidence.sourceUrl }} · {{ evidence.line }}:{{
              evidence.column
            }}</small
          >
          <pre tabindex="0">{{ evidence.snippet }}</pre>
        </div>
        <pre v-else tabindex="0" aria-label="Web 探测详情">{{
          selected ? detail(selected) : '选择条目查看详情'
        }}</pre>
        <details v-if="evidence">
          <summary>条目字段</summary>
          <pre>{{ detail(selected) }}</pre>
        </details>
        <details v-if="report?.warnings.length">
          <summary>分析提示（{{ report.warnings.length }}）</summary>
          <p v-for="warning in report.warnings" :key="warning">{{ warning }}</p>
        </details>
        <p v-if="message" role="status">{{ message }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.web-probe {
  display: grid;
  grid-template-rows: 38px minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  font-size: 12px;
}
.probe-toolbar,
nav,
.request-form,
.asset-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.probe-toolbar {
  padding: 4px 10px;
  overflow-x: auto;
  border-bottom: 1px solid var(--line);
}
button,
input {
  font: inherit;
  color: var(--text);
  border: 1px solid var(--line-strong);
  border-radius: 4px;
  background: white;
  padding: 4px 7px;
}
button {
  cursor: pointer;
  white-space: nowrap;
}
button:disabled {
  cursor: default;
  opacity: 0.5;
}
input {
  min-width: 0;
}
.probe-toolbar input {
  min-width: 150px;
}
.count {
  margin-left: auto;
  white-space: nowrap;
  color: var(--text-muted);
}
.probe-content {
  display: grid;
  grid-template-columns: minmax(250px, 42%) minmax(0, 1fr);
  min-height: 0;
}
.catalog {
  display: grid;
  grid-template-rows: 32px minmax(0, 1fr);
  min-height: 0;
  border-right: 1px solid var(--line);
  min-width: 0;
}
nav {
  padding: 3px 8px;
  overflow-x: auto;
}
nav button {
  border: 0;
  background: transparent;
}
nav .active {
  background: var(--green-soft);
  color: var(--green-strong);
}
.rows,
.probe-detail {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
.row {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  padding: 7px 10px;
  background: transparent;
  min-width: 0;
}
.row:hover,
.row:focus {
  background: var(--green-soft);
}
.row strong,
.row small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: normal;
}
.row small,
.empty {
  color: var(--text-muted);
  margin-top: 3px;
}
.asset-row > .row {
  flex: 1;
}
.asset-row > button:last-child {
  margin-right: 5px;
}
.probe-detail {
  padding: 8px 10px;
}
.request-form input:first-child {
  flex: 1;
}
.xtbz {
  width: 48px;
}
.fill {
  margin-top: 6px;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 11px;
  line-height: 1.5;
}
.source-detail {
  margin-top: 8px;
  overflow-wrap: anywhere;
}
details {
  margin-top: 6px;
  overflow-wrap: anywhere;
}
.empty {
  padding: 8px;
}
</style>
