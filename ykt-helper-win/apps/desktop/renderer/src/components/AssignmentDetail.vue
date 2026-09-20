<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import {
  BrowserEnvironment,
  canOpenAssignmentAnswer,
  type Assignment,
  type AssignmentDetail,
} from '@ykt/contracts';
import { assignmentStatusLabel } from '../assignment-status';
import { detailBodyHtml } from '../assignment-body';
import AssignmentBody from './AssignmentBody.vue';

const props = defineProps<{ assignment: Assignment }>();
const emit = defineEmits<{ back: []; updated: [assignment: Assignment] }>();
const detail = ref<AssignmentDetail | null>(null);
const loading = ref(false),
  answering = ref(false),
  error = ref('');
const now = ref(Date.now());
const timer = setInterval(() => {
  now.value = Date.now();
}, 1000);
let generation = 0;
const current = computed(() => detail.value?.assignment ?? props.assignment);
const html = computed(() => (detail.value ? detailBodyHtml(detail.value) : ''));
const canAnswer = computed(
  () =>
    !loading.value &&
    !error.value &&
    !!detail.value &&
    canOpenAssignmentAnswer(detail.value, now.value),
);
function accept(value: AssignmentDetail) {
  detail.value = value;
  emit('updated', value.assignment);
}
async function refresh(force = false) {
  const seq = ++generation;
  loading.value = true;
  error.value = '';
  try {
    const value = await window.yuketang.getAssignmentDetail(
      BrowserEnvironment.Pro,
      props.assignment.id,
      force,
    );
    if (seq === generation) accept(value);
  } catch (e) {
    if (seq === generation)
      error.value = e instanceof Error ? e.message : '详情加载失败，请重试。';
  } finally {
    if (seq === generation) loading.value = false;
  }
}
async function openOfficial() {
  try {
    await window.yuketang.selectBrowserEnvironment(BrowserEnvironment.Pro);
    await window.yuketang.browserNavigate(current.value.url);
  } catch {
    error.value = '官网打开失败，请重试。';
  }
}
async function answer() {
  if (!canAnswer.value || answering.value) return;
  answering.value = true;
  error.value = '';
  const seq = generation;
  try {
    const value = await window.yuketang.openAssignmentAnswer(
      props.assignment.id,
    );
    if (seq === generation) accept(value);
  } catch (e) {
    if (seq === generation)
      error.value =
        e instanceof Error ? e.message : '作答页打开失败，请刷新后重试。';
  } finally {
    if (seq === generation) answering.value = false;
  }
}
watch(
  () => props.assignment.id,
  () => {
    detail.value = null;
    void refresh();
  },
  { immediate: true },
);
onUnmounted(() => {
  generation++;
  clearInterval(timer);
});
function time(value: number) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
</script>

<template>
  <div class="assignment-detail" :aria-busy="loading">
    <div class="actions">
      <button @click="emit('back')">← 返回列表</button>
      <button :disabled="loading || answering" @click="refresh(true)">
        {{ loading ? '读取中…' : '刷新详情' }}
      </button>
      <button @click="openOfficial">在官网查看 ↗</button>
    </div>
    <p class="muted">
      {{ current.courseName }} · {{ current.kind === 'exam' ? '考试' : '作业' }}
    </p>
    <h2>{{ current.title }}</h2>
    <p>
      {{ assignmentStatusLabel(current)
      }}<template v-if="current.score !== null && current.totalScore !== null">
        · 得分 {{ current.score }} / {{ current.totalScore }}
      </template>
    </p>
    <p>
      截止：{{ current.deadline === null ? '未提供' : time(current.deadline) }}
    </p>
    <p v-if="current.answeredCount !== null">
      已答 {{ current.answeredCount
      }}<template v-if="current.totalCount !== null">
        / {{ current.totalCount }}
      </template>
      题
    </p>
    <p v-if="detail?.lateAllowed">
      允许补交<template v-if="detail.lateDeadline !== null">
        · 截止 {{ time(detail.lateDeadline) }}
      </template>
    </p>
    <button
      v-if="canAnswer || answering"
      class="answer"
      :disabled="answering"
      @click="answer"
    >
      {{ answering ? '作答页已打开…' : '前往作答' }}
    </button>
    <p v-if="error" class="error" role="alert">
      {{ error }}<template v-if="detail"> 当前显示上次读取的详情。</template>
    </p>
    <p v-if="loading && !detail" role="status">正在读取详情…</p>
    <template v-if="detail">
      <p v-if="detail.mode === 'exam-cover'" class="muted">
        题目内容请在官网查看。
      </p>
      <p
        v-else-if="!detail.problems.length && !detail.descriptionHtml"
        class="muted"
      >
        暂无题目内容。
      </p>
      <AssignmentBody
        v-else
        :key="detail.fetchedAt"
        :html="html"
        :font-url="detail.fontUrl"
      />
    </template>
  </div>
</template>

<style scoped>
.assignment-detail {
  font-size: 13px;
  line-height: 1.6;
}
h2 {
  font-size: 18px;
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
button {
  font: inherit;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  padding: 6px 8px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
button:disabled {
  opacity: 0.6;
  cursor: wait;
}
.muted {
  color: var(--text-muted);
}
.error {
  background: #fff0ee;
  color: #93413b;
  padding: 10px;
  border-radius: 6px;
}
.answer {
  margin-bottom: 12px;
  background: #e9f5ec;
  color: #24623c;
}
</style>
