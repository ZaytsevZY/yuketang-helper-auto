<script setup lang="ts">
import { computed } from 'vue';
import {
  ProblemType,
  type Presentation,
  type ProblemContext,
} from '@ykt/contracts';

const props = defineProps<{
  modelValue: string;
  problems: readonly ProblemContext[];
  presentations: readonly Presentation[];
}>();

const emit = defineEmits<{
  'update:modelValue': [problemId: string];
}>();

const choices = computed(() =>
  props.problems.map((problem) => {
    const presentation = props.presentations.find(
      (item) => item.id === problem.presentationId,
    );
    const slide = presentation?.slides.find(
      (item) => item.id === problem.slideId,
    );
    return { problem, presentation, slide };
  }),
);

function typeLabel(type: ProblemContext['type']): string {
  return {
    [ProblemType.SingleChoice]: '单选题',
    [ProblemType.MultipleChoice]: '多选题',
    [ProblemType.Poll]: '投票题',
    [ProblemType.FillBlank]: '填空题',
    [ProblemType.Subjective]: '主观题',
    [ProblemType.Unknown]: '未知题型',
  }[type];
}

function statusLabel(status: ProblemContext['status']): string {
  return {
    locked: '未开放',
    available: '可作答',
    answered: '已作答',
    expired: '已截止',
  }[status];
}
</script>

<template>
  <div
    v-if="choices.length"
    class="problem-picker"
    role="listbox"
    aria-label="题目列表"
  >
    <button
      v-for="choice in choices"
      :key="choice.problem.id"
      type="button"
      class="problem-choice"
      :class="{
        selected: choice.problem.id === modelValue,
        [`status-${choice.problem.status}`]: true,
      }"
      role="option"
      :aria-selected="choice.problem.id === modelValue"
      @click="emit('update:modelValue', choice.problem.id)"
    >
      <span class="problem-thumbnail">
        <img
          v-if="choice.slide?.imageUrl"
          :src="choice.slide.imageUrl"
          :alt="`题目 ${choice.problem.id} 所在课件页`"
        />
        <span v-else>
          {{ choice.slide ? `第 ${choice.slide.index + 1} 页` : '暂无缩略图' }}
        </span>
      </span>
      <span class="problem-choice-content">
        <span class="problem-choice-heading">
          <strong>
            {{
              choice.slide
                ? `第 ${choice.slide.index + 1} 页 · ${typeLabel(choice.problem.type)}`
                : typeLabel(choice.problem.type)
            }}
          </strong>
          <span class="problem-status">
            {{ statusLabel(choice.problem.status) }}
          </span>
        </span>
        <span class="problem-prompt">
          {{
            choice.problem.prompt || choice.slide?.title || '题干位于课件图片中'
          }}
        </span>
        <small :title="choice.problem.id">ID {{ choice.problem.id }}</small>
        <small v-if="choice.presentation?.title">
          {{ choice.presentation.title }}
        </small>
      </span>
    </button>
  </div>
  <div v-else class="problem-picker-empty">尚未载入题目</div>
</template>

<style scoped>
.problem-picker {
  display: grid;
  max-height: 270px;
  gap: 6px;
  overflow: auto;
  padding: 1px;
}

.problem-choice {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  min-height: 68px;
  gap: 9px;
  align-items: stretch;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  padding: 6px;
  color: var(--text);
  background: #fff;
  text-align: left;
}

.problem-choice:hover {
  border-color: #85b99b;
  background: #fbfefc;
}

.problem-choice.selected {
  border-color: var(--green);
  box-shadow: 0 0 0 2px rgb(8 138 87 / 12%);
  background: var(--green-soft);
}

.problem-thumbnail {
  display: grid;
  min-height: 54px;
  overflow: hidden;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 5px;
  color: var(--text-muted);
  background: #f5f7f6;
  font-size: 9px;
  text-align: center;
}

.problem-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #fff;
}

.problem-choice-content,
.problem-choice-heading {
  min-width: 0;
}

.problem-choice-content {
  display: grid;
  align-content: start;
  gap: 3px;
}

.problem-choice-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
}

.problem-choice-heading strong {
  overflow: hidden;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.problem-status {
  flex: 0 0 auto;
  border-radius: 4px;
  padding: 2px 4px;
  color: var(--text-muted);
  background: #eef1ef;
  font-size: 8px;
}

.status-available .problem-status,
.status-answered .problem-status {
  color: #12683e;
  background: #dff1e7;
}

.status-expired .problem-status {
  color: #8a5a10;
  background: #fff0ce;
}

.problem-prompt,
.problem-choice-content small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.problem-prompt {
  color: var(--text);
  font-size: 10px;
  font-weight: 600;
}

.problem-choice-content small {
  color: var(--text-muted);
  font-size: 8px;
}

.problem-picker-empty {
  border: 1px dashed var(--line-strong);
  border-radius: 7px;
  padding: 16px;
  color: var(--text-muted);
  font-size: 10px;
  text-align: center;
}
</style>
