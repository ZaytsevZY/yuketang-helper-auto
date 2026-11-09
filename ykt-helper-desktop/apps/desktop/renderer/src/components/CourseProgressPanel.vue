<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue';
import {
  BrowserEnvironment,
  isCourseProgressRangeMonths,
  type CourseAttentionKind,
  type CourseProgressItem,
} from '@ykt/contracts';
import { courseProgressCollection } from '../course-progress-collection';

const props = defineProps<{ environment: BrowserEnvironment }>();
const { snapshot, loading, error, rangeMonths } = toRefs(
  courseProgressCollection.state,
);
const search = ref('');
const view = ref<'attention' | 'all'>('attention');
const supported = computed(() => props.environment === BrowserEnvironment.Pro);
const lessons = computed(() => snapshot.value?.lessons ?? []);
const attentionCount = computed(
  () => lessons.value.filter((item) => item.attention.length).length,
);
const filtered = computed(() =>
  lessons.value.filter((item) => {
    const query = search.value.trim().toLocaleLowerCase();
    return (
      (view.value === 'all' || item.attention.length > 0) &&
      (!query ||
        `${item.courseName} ${item.title}`.toLocaleLowerCase().includes(query))
    );
  }),
);

watch(
  supported,
  (enabled) => {
    if (enabled) void courseProgressCollection.initialize();
  },
  { immediate: true },
);

function attentionLabel(kind: CourseAttentionKind): string {
  return {
    'checkin-unrecorded': '疑似缺勤',
    'live-unwatched': '直播未观看',
    'replay-unwatched': '回放未观看',
    'replay-incomplete': '回放未完成',
  }[kind];
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatRate(value: number | null): string | null {
  if (value === null) return null;
  const percent = value <= 1 ? value * 100 : value;
  return `${Math.min(100, Math.round(percent))}%`;
}

function changeRange(event: Event): void {
  const value = Number((event.target as HTMLSelectElement).value);
  if (isCourseProgressRangeMonths(value))
    void courseProgressCollection.setRange(value);
}

async function openLesson(item: CourseProgressItem): Promise<void> {
  try {
    error.value = '';
    await window.yuketang.selectBrowserEnvironment(BrowserEnvironment.Pro);
    await window.yuketang.browserNavigate(item.url);
  } catch {
    error.value = '无法打开课堂报告，请在荷塘雨课堂查看。';
  }
}
</script>

<template>
  <div class="course-progress" :aria-busy="loading">
    <div class="heading">
      <div>
        <h2>课程</h2>
        <p>已结束课堂的签到与观看状态</p>
      </div>
      <button
        v-if="supported"
        type="button"
        :disabled="loading"
        @click="courseProgressCollection.refresh()"
      >
        {{ loading ? '读取中…' : '刷新' }}
      </button>
    </div>
    <div v-if="!supported" class="message">
      目前支持荷塘雨课堂的课程进度。切换环境并登录后即可读取。
    </div>
    <template v-else>
      <div v-if="error" class="message error" role="alert">
        {{ error }}<span v-if="snapshot"> 以下仍显示上次收集结果。</span>
      </div>
      <div v-if="snapshot" class="summary" aria-live="polite">
        <strong>{{ attentionCount }} 节需关注</strong>
        <span
          >已核对 {{ snapshot.lessons.length }} /
          {{ snapshot.scannedLessons }} 节课堂</span
        >
        <small>更新于 {{ formatTime(snapshot.fetchedAt) }}</small>
      </div>
      <p class="note">
        “疑似缺勤”表示学习日志未标记出勤，且当前报告没有有效签到记录；请以教师记录为准。
      </p>
      <label class="range-filter">
        探测时间
        <select
          :value="rangeMonths"
          :disabled="loading"
          aria-label="课程探测时间范围"
          @change="changeRange"
        >
          <option :value="1">最近 1 个月</option>
          <option :value="3">最近 3 个月</option>
          <option :value="6">最近 6 个月</option>
          <option :value="12">最近 1 年</option>
        </select>
      </label>
      <div
        v-for="warning in snapshot?.warnings.slice(0, 5)"
        :key="warning"
        class="message warning"
        role="status"
      >
        {{ warning }}
      </div>
      <p v-if="(snapshot?.warnings.length ?? 0) > 5" class="note">
        另有 {{ snapshot!.warnings.length - 5 }} 条读取提示。
      </p>
      <div class="filters">
        <input
          v-model="search"
          type="search"
          placeholder="搜索课程或课堂"
          aria-label="搜索课程或课堂"
        />
        <select v-model="view" aria-label="课程显示范围">
          <option value="attention">需关注</option>
          <option value="all">全部已核对</option>
        </select>
      </div>
      <p v-if="loading" class="empty" role="status">正在读取课程报告…</p>
      <p v-else-if="snapshot && !filtered.length" class="empty">
        {{
          lessons.length
            ? '当前筛选条件下没有需关注的课堂。'
            : '所选时间范围内尚未发现已结束的课堂。'
        }}
      </p>
      <div class="lesson-list">
        <article
          v-for="item in filtered"
          :key="item.lessonId"
          class="lesson-row"
        >
          <small
            >{{ item.courseName
            }}<template v-if="item.startedAt !== null">
              · {{ formatTime(item.startedAt) }}</template
            ></small
          >
          <h3>{{ item.title }}</h3>
          <div class="status-list">
            <span
              v-for="kind in item.attention"
              :key="kind"
              class="status"
              :class="kind"
            >
              {{ attentionLabel(kind) }}
            </span>
            <span
              v-if="!item.attention.length && !item.statusMessage"
              class="status clear"
              >暂无待处理状态</span
            >
          </div>
          <p
            v-if="item.liveRate !== null || item.replayRate !== null"
            class="rates"
          >
            <span v-if="item.liveRate !== null"
              >直播 {{ formatRate(item.liveRate) }}</span
            >
            <span v-if="item.replayRate !== null"
              >回放 {{ formatRate(item.replayRate) }}</span
            >
          </p>
          <p v-if="item.statusMessage" class="status-message">
            {{ item.statusMessage }}
          </p>
          <button type="button" class="open-link" @click="openLesson(item)">
            在官网查看课堂报告
          </button>
        </article>
      </div>
    </template>
  </div>
</template>

<style scoped>
.course-progress {
  font-size: 12px;
  line-height: 1.55;
}
.heading {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 10px;
}
h2 {
  margin: 0;
  font-size: 18px;
}
h3 {
  margin: 2px 0 8px;
  font-size: 15px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
p {
  margin: 5px 0;
}
.heading p,
.summary small,
.lesson-row small,
.rates,
.status-message {
  color: var(--text-muted);
}
button,
input,
select {
  font: inherit;
  color: var(--text);
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--surface);
  padding: 6px 8px;
  min-width: 0;
}
button {
  cursor: pointer;
}
button:disabled {
  cursor: wait;
  opacity: 0.6;
}
.heading button {
  flex: none;
}
.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: baseline;
  padding: 12px 0 8px;
}
.summary strong {
  color: var(--text);
}
.summary small {
  flex-basis: 100%;
}
.note {
  color: var(--text-muted);
}
.range-filter {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0;
  color: var(--text-muted);
}
.range-filter select {
  color: var(--text);
}
.message {
  margin: 10px 0;
  padding: 9px;
  border-radius: 6px;
  background: var(--surface-subtle);
}
.message.error {
  color: #8d2d2d;
  background: #fff3f1;
}
.message.warning {
  color: #85570d;
  background: #fff9e9;
}
.filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  margin: 14px 0;
}
.filters input {
  width: 100%;
}
.empty {
  margin: 16px 0;
  color: var(--text-muted);
}
.lesson-list {
  border-top: 1px solid var(--line);
}
.lesson-row {
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.lesson-row small {
  display: block;
  overflow-wrap: anywhere;
}
.status-list,
.rates {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 7px;
}
.status {
  display: inline-block;
  padding: 2px 5px;
  border-radius: 4px;
  background: #fff9e9;
  color: #85570d;
}
.status.checkin-unrecorded {
  background: #fff3f1;
  color: #8d2d2d;
}
.status.clear {
  background: #eaf6ef;
  color: #066d46;
}
.rates {
  margin-top: 8px;
  font-variant-numeric: tabular-nums;
}
.open-link {
  margin-top: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #066d46;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-align: left;
}
.open-link:hover {
  color: #088a57;
}
button:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 2px solid #088a57;
  outline-offset: 2px;
}
</style>
