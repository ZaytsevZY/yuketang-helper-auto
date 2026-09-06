<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type {
  ClassroomNotice,
  ClassroomSimulationAction,
  ClassroomSimulationState,
} from '@ykt/contracts';

const state = ref<ClassroomSimulationState>();
const notices = ref<readonly ClassroomNotice[]>([]);
const busy = ref<ClassroomSimulationAction | ''>('');
const errorMessage = ref('');
let unsubscribe: (() => void) | undefined;

const statusText = computed(() => {
  if (!state.value || state.value.status === 'upcoming') return '未启动';
  return state.value.status === 'active' ? '进行中' : '已结束';
});

onMounted(async () => {
  unsubscribe = window.yuketang.onClassroomNotice((notice) => {
    if (notice.lessonId !== state.value?.lessonId) return;
    notices.value = [notice, ...notices.value].slice(0, 12);
  });
  try {
    state.value = await window.yuketang.getClassroomSimulation();
  } catch (error) {
    errorMessage.value = errorText(error);
  }
});

onUnmounted(() => unsubscribe?.());

async function run(action: ClassroomSimulationAction): Promise<void> {
  busy.value = action;
  errorMessage.value = '';
  try {
    state.value = await window.yuketang.runClassroomSimulation(action);
    if (action === 'reset') notices.value = [];
  } catch (error) {
    errorMessage.value = errorText(error);
  } finally {
    busy.value = '';
  }
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : '课堂模拟操作失败。';
}
</script>

<template>
  <div class="simulator">
    <div class="simulator-heading">
      <div>
        <h2>课堂模拟器</h2>
        <span>本地双端事件实验</span>
      </div>
      <button type="button" :disabled="Boolean(busy)" @click="run('reset')">
        {{ busy === 'reset' ? '重置中' : '重置课堂' }}
      </button>
    </div>

    <p v-if="errorMessage" class="simulator-error" role="alert">
      {{ errorMessage }}
    </p>

    <section class="simulator-pane teacher-pane">
      <div class="pane-heading">
        <h3>教师端</h3>
        <span>{{ statusText }}</span>
      </div>
      <div class="teacher-actions">
        <button
          type="button"
          :disabled="Boolean(busy) || state?.status === 'ended'"
          @click="run('show-slide')"
        >
          展示下一页
        </button>
        <button
          type="button"
          :disabled="Boolean(busy) || state?.status === 'ended'"
          @click="run('publish-courseware')"
        >
          发布课件
        </button>
        <button
          type="button"
          :disabled="Boolean(busy) || state?.status === 'ended'"
          @click="run('publish-problem-object')"
        >
          发布对象题目
        </button>
        <button
          type="button"
          :disabled="Boolean(busy) || state?.status === 'ended'"
          @click="run('publish-problem-scalar')"
        >
          发布标量题目
        </button>
        <button
          class="finish-button"
          type="button"
          :disabled="Boolean(busy) || state?.status !== 'active'"
          @click="run('finish-lesson')"
        >
          结束课堂
        </button>
      </div>
      <dl class="simulation-facts">
        <div>
          <dt>当前页</dt>
          <dd>{{ state?.currentSlide ?? 1 }} / 3</dd>
        </div>
        <div>
          <dt>最近操作</dt>
          <dd>{{ state?.lastEvent ?? '尚未启动' }}</dd>
        </div>
      </dl>
    </section>

    <section class="simulator-pane student-pane">
      <div class="pane-heading">
        <h3>学生端</h3>
        <span>{{ state?.publishedProblemIds.length ?? 0 }} 道题</span>
      </div>
      <div v-if="state?.publishedProblemIds.length" class="published-list">
        <span v-for="id in state.publishedProblemIds" :key="id">{{ id }}</span>
      </div>
      <p v-else class="student-empty">等待教师端发布题目。</p>

      <div class="event-heading">收到的课堂提醒</div>
      <ol v-if="notices.length" class="simulator-events">
        <li
          v-for="notice in notices"
          :key="`${notice.dedupeKey}:${notice.occurredAt}`"
        >
          <div>
            <strong>{{ notice.title }}</strong>
            <span>{{ notice.detail }}</span>
          </div>
          <time>{{ formatTime(notice.occurredAt) }}</time>
        </li>
      </ol>
      <p v-else class="student-empty">尚未收到提醒事件。</p>
    </section>

    <p class="simulation-note">
      模拟事件只进入 Backend
      课堂正规化与提醒链路，不连接雨课堂服务器，也不写入网络实验室。
    </p>
  </div>
</template>

<style scoped>
.simulator {
  display: grid;
  gap: 14px;
}

.simulator-heading,
.pane-heading,
.simulation-facts div,
.simulator-events li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.simulator-heading h2,
.pane-heading h3,
.simulation-facts,
.simulator-events {
  margin: 0;
}

.simulator-heading h2 {
  font-size: 18px;
}

.simulator-heading span,
.pane-heading span,
.student-empty,
.simulation-note,
.simulator-events span,
.simulator-events time {
  color: var(--text-muted);
  font-size: 12px;
}

.simulator-heading span {
  display: block;
  margin-top: 3px;
}

button {
  min-height: 30px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  padding: 6px 10px;
  color: var(--green-strong);
  background: #f8fcfa;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

button:hover:not(:disabled) {
  border-color: var(--green);
  background: var(--green-soft);
}

button:disabled {
  color: var(--text-muted);
  background: var(--surface-subtle);
  cursor: default;
}

button:focus-visible {
  outline: 2px solid #42a878;
  outline-offset: 2px;
}

.simulator-pane {
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 11px;
  background: var(--surface);
}

.pane-heading {
  padding-bottom: 9px;
  border-bottom: 1px solid var(--line);
}

.pane-heading h3,
.event-heading {
  font-size: 12px;
  font-weight: 750;
}

.teacher-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 10px 0;
}

.finish-button {
  grid-column: 1 / -1;
  color: #8d2d2d;
  background: #fff8f7;
}

.simulation-facts {
  display: grid;
  gap: 5px;
  font-size: 12px;
}

.simulation-facts dt {
  color: var(--text-muted);
}

.simulation-facts dd {
  margin: 0;
  text-align: right;
}

.published-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 10px 0;
}

.published-list span {
  border-radius: 4px;
  padding: 3px 5px;
  color: var(--green-strong);
  background: var(--green-soft);
  font-family: Consolas, monospace;
  font-size: 12px;
}

.event-heading {
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.simulator-events {
  padding: 4px 0 0;
  list-style: none;
}

.simulator-events li {
  align-items: flex-start;
  padding: 7px 0;
  border-bottom: 1px solid var(--line);
}

.simulator-events li:last-child {
  border-bottom: 0;
}

.simulator-events strong,
.simulator-events span {
  display: block;
  font-size: 12px;
}

.simulator-events span {
  margin-top: 2px;
  line-height: 1.4;
}

.simulator-events time {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}

.student-empty,
.simulation-note {
  margin: 10px 0 0;
  line-height: 1.55;
}

.simulation-note {
  margin: 0;
}

.simulator-error {
  margin: 0;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  padding: 8px 9px;
  color: #8d2d2d;
  background: #fff3f1;
  font-size: 12px;
}
</style>
