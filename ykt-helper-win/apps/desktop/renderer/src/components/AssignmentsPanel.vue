<script setup lang="ts">
import { computed, onUnmounted, ref, toRefs, watch } from 'vue';
import AssignmentDetail from './AssignmentDetail.vue';
import type { AssignmentAiDraft } from '../assignment-ai';
import { assignmentCollection } from '../assignment-collection';
import { BrowserEnvironment, type Assignment } from '@ykt/contracts';
import {
  assignmentStatusLabel,
  matchesAssignmentStatus,
} from '../assignment-status';

const props = defineProps<{ environment: BrowserEnvironment }>();
const emit = defineEmits<{ explain: [draft: AssignmentAiDraft] }>();
const { snapshot, loading, error } = toRefs(assignmentCollection.state);
const selected = ref<Assignment | null>(null);
watch(
  () => props.environment,
  () => {
    selected.value = null;
  },
);
function updateAssignment(item: Assignment) {
  if (snapshot.value)
    snapshot.value = {
      ...snapshot.value,
      assignments: snapshot.value.assignments.map((current) =>
        current.id === item.id ? item : current,
      ),
    };
  if (selected.value?.id === item.id) selected.value = item;
}
const search = ref('');
const kind = ref('all');
const status = ref('all');
const now = ref(Date.now());
const clock = setInterval(() => {
  now.value = Date.now();
}, 30_000);
onUnmounted(() => {
  clearInterval(clock);
});

const supported = computed(() => props.environment === BrowserEnvironment.Pro);
const assignments = computed(() => snapshot.value?.assignments ?? []);
const filtered = computed(() =>
  assignments.value.filter((item) => {
    const query = search.value.trim().toLocaleLowerCase();
    return (
      (!query ||
        `${item.courseName} ${item.title}`
          .toLocaleLowerCase()
          .includes(query)) &&
      (kind.value === 'all' || item.kind === kind.value) &&
      matchesAssignmentStatus(item, status.value, now.value)
    );
  }),
);
const unfinished = computed(
  () =>
    assignments.value.filter(
      (item) => item.status === 'unanswered' || item.status === 'partial',
    ).length,
);

async function refresh(): Promise<void> {
  if (!supported.value) return;
  await assignmentCollection.refresh();
}

async function open(url?: string): Promise<void> {
  try {
    error.value = '';
    await window.yuketang.selectBrowserEnvironment(BrowserEnvironment.Pro);
    if (url) await window.yuketang.browserNavigate(url);
  } catch {
    error.value = '无法打开荷塘雨课堂，请重试。';
  }
}

function overdue(item: Assignment): boolean {
  return item.deadline !== null && item.deadline <= now.value;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function remaining(item: Assignment): string {
  if (item.deadline === null) return '未提供截止时间';
  const minutes = Math.ceil((item.deadline - now.value) / 60_000);
  if (minutes <= 0) return '已截止';
  if (minutes < 60) return `剩余 ${minutes} 分钟`;
  if (minutes < 1440) return `剩余 ${Math.floor(minutes / 60)} 小时`;
  return `剩余 ${Math.floor(minutes / 1440)} 天`;
}
</script>

<template>
  <AssignmentDetail
    v-if="selected && supported"
    :assignment="selected"
    @back="selected = null"
    @updated="updateAssignment"
    @explain="emit('explain', $event)"
  />
  <div v-else class="assignments-panel" :aria-busy="loading">
    <div class="heading">
      <div>
        <h2>作业 / 考试</h2>
        <p class="muted">荷塘雨课堂 · 按截止时间排序</p>
      </div>
      <button v-if="supported" :disabled="loading" @click="refresh">
        {{ loading ? '读取中…' : '刷新' }}
      </button>
    </div>
    <div v-if="!supported" class="notice">
      <p>
        目前支持荷塘雨课堂作业。切换后，在左侧网页完成登录，再刷新即可读取。
      </p>
      <button @click="open()">切换到荷塘雨课堂</button>
    </div>
    <template v-else>
      <div v-if="error" class="notice error" role="alert">
        <p>{{ error }}</p>
        <p v-if="snapshot">以下为上次读取的结果，当前状态可能已变化。</p>
        <button @click="open('https://pro.yuketang.cn/')">打开登录页</button>
      </div>
      <div v-if="snapshot" class="summary" aria-live="polite">
        <strong>{{ assignments.length }} 项</strong> ·
        {{ unfinished }} 项未全部作答 ·
        {{
          assignments.filter((item) =>
            matchesAssignmentStatus(item, 'unknown', now),
          ).length
        }}
        项状态未知
        <p class="muted">
          更新于 {{ formatTime(snapshot.fetchedAt) }}（本地时间）
        </p>
      </div>
      <div
        v-for="warning in snapshot?.warnings"
        :key="warning"
        class="notice warning"
        role="status"
      >
        {{ warning }}
      </div>
      <div class="filters">
        <input
          v-model="search"
          type="search"
          placeholder="搜索课程或作业"
          aria-label="搜索课程或作业"
        />
        <select v-model="kind" aria-label="作业类型">
          <option value="all">全部类型</option>
          <option value="homework">作业</option>
          <option value="exam">考试</option>
        </select>
        <select v-model="status" aria-label="作答状态">
          <option value="all">全部状态</option>
          <option value="unanswered">未作答</option>
          <option value="partial">部分 / 有作答</option>
          <option value="answered">全部已答</option>
          <option value="submitted">考试已交卷</option>
          <option value="graded">已批改</option>
          <option value="unknown">状态未知</option>
          <option value="overdue">已截止</option>
        </select>
      </div>
      <p v-if="loading" class="muted" role="status">正在读取作业…</p>
      <p v-else-if="snapshot && !filtered.length" class="empty">
        {{
          assignments.length
            ? '没有符合筛选条件的作业。'
            : snapshot.warnings.length
              ? '本次未能读到作业，请处理上方提示后重试。'
              : '当前课程暂无作业或考试。'
        }}
      </p>
      <article v-for="item in filtered" :key="item.id" class="assignment-card">
        <div class="card-top">
          <span class="muted"
            >{{ item.courseName
            }}<span v-if="item.audited" class="audit-badge">旁听</span></span
          ><span class="kind">{{
            item.kind === 'exam' ? '考试' : '作业'
          }}</span>
        </div>
        <h3>
          <button
            class="title-link"
            @click="item.leafTypeId ? (selected = item) : open(item.url)"
          >
            {{ item.title }}
          </button>
        </h3>
        <div class="card-top">
          <span class="badge" :class="item.graded ? 'answered' : item.status">{{
            assignmentStatusLabel(item)
          }}</span
          ><span class="deadline-state" :class="{ overdue: overdue(item) }">{{
            remaining(item)
          }}</span>
        </div>
        <p class="deadline">
          截止：<time
            v-if="item.deadline !== null"
            :datetime="new Date(item.deadline).toISOString()"
            >{{ formatTime(item.deadline) }}</time
          ><span v-else>未提供</span>
        </p>
        <p v-if="item.answeredCount !== null" class="progress-label">
          {{
            item.totalCount === null
              ? `已答 ${item.answeredCount} 题`
              : `已答 ${item.answeredCount} / ${item.totalCount} 题`
          }}
        </p>
        <p v-if="item.score != null && item.totalScore != null" class="score">
          得分 {{ item.score }} / {{ item.totalScore }}
        </p>
        <details v-if="item.questions.length">
          <summary>查看逐题状态（{{ item.questions.length }} 题）</summary>
          <ol class="questions">
            <li
              v-for="question in item.questions"
              :key="question.index"
              :class="{ done: question.answered === true }"
            >
              第 {{ question.index }} 题 ·
              {{
                question.answered === null
                  ? '未知'
                  : question.answered
                    ? '已答'
                    : '未答'
              }}
            </li>
          </ol>
        </details>
        <p v-if="item.statusMessage" class="muted">{{ item.statusMessage }}</p>
        <button
          v-if="item.leafTypeId"
          class="open-link"
          @click="selected = item"
        >
          查看详情
        </button>
        <button class="open-link" @click="open(item.url)">在官网查看 ↗</button>
      </article>
    </template>
  </div>
</template>

<style scoped>
.assignments-panel {
  font-size: 12px;
  line-height: 1.6;
}
.heading,
.card-top {
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
  margin: 10px 0;
  font-size: 15px;
  overflow-wrap: anywhere;
}
p {
  margin: 6px 0;
}
.muted {
  color: var(--text-muted);
}
button,
select,
input {
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
  opacity: 0.6;
  cursor: wait;
}
.heading button {
  flex-shrink: 0;
}
.summary {
  padding: 12px 0;
}
.filters {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 12px 0;
}
.filters input {
  grid-column: 1 / -1;
  width: 100%;
}
.assignment-card {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px;
  margin: 12px 0;
  background: var(--surface);
}
.card-top .muted {
  overflow-wrap: anywhere;
}
.kind {
  white-space: nowrap;
  color: var(--text-muted);
}
.audit-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 0 5px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 11px;
}
.score {
  font-weight: 600;
}
.badge {
  padding: 2px 8px;
  border-radius: 4px;
  background: #eef1f3;
  color: #53616b;
}
.badge.answered,
.questions .done {
  background: #e9f5ec;
  color: #24623c;
}
.badge.partial {
  background: #fff3dc;
  color: #85570d;
}
.badge.unanswered {
  background: #fbecea;
  color: #93413b;
}
.overdue {
  color: #93413b;
}
.deadline {
  margin-top: 10px;
}
.notice {
  padding: 10px;
  margin: 10px 0;
  border-radius: 6px;
  background: #f0f4f5;
}
.error {
  background: #fff0ee;
  color: #93413b;
}
.warning {
  background: #fff3dc;
  color: #85570d;
}
.empty {
  text-align: center;
  padding: 24px 0;
  color: var(--text-muted);
}
summary {
  cursor: pointer;
  margin: 8px 0;
}
.questions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 0;
  list-style: none;
}
.questions li {
  padding: 4px 6px;
  background: #f1f3f4;
  border-radius: 4px;
}
.title-link {
  border: 0;
  padding: 0;
  text-align: left;
  font-weight: 600;
  background: none;
}
.open-link {
  margin-top: 10px;
  width: 100%;
}
</style>
