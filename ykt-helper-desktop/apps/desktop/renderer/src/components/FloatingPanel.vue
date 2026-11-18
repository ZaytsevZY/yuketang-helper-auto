<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { ToolPanelId, ToolPanelState } from '@ykt/contracts';
import { useFloatingPanel } from '../composables/useFloatingPanel';

const props = defineProps<{
  id: ToolPanelId;
  title: string;
  state: ToolPanelState | undefined;
  canArrange?: boolean;
}>();
const emit = defineEmits<{ launcher: []; close: [] }>();
const titleButton = ref<HTMLButtonElement>();
const panelState = computed(() => props.state);
const { interaction, error, maximized, start, move, stop, keyboard, run } =
  useFloatingPanel(props.id, panelState, (command) =>
    window.yuketang.controlToolPanel(command),
  );
watch(
  () => props.state?.visible,
  async (visible) => {
    if (visible) {
      await nextTick();
      titleButton.value?.focus();
    }
  },
  { immediate: true },
);
function focus(): void {
  if (!props.state?.focused) void run({ action: 'focus', id: props.id });
}
function close(): void {
  stop();
  emit('close');
}
</script>

<template>
  <section
    class="floating-workspace"
    :class="{
      'panel-focused': state?.focused,
      'panel-interacting': interaction,
    }"
    role="region"
    :aria-label="title"
    @pointerdown.capture="focus"
    @focusin="focus"
    @keydown.esc.stop.prevent="close"
  >
    <header class="floating-titlebar">
      <button
        v-if="id !== 'tools'"
        class="window-control"
        type="button"
        aria-label="打开全部工具"
        title="打开全部工具"
        @click="emit('launcher')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
        </svg>
      </button>
      <button
        ref="titleButton"
        class="panel-drag-handle"
        type="button"
        :aria-label="`移动${title}面板，方向键微调`"
        title="拖动移动 · 方向键微调 · 双击展开"
        @pointerdown="start($event, 'move')"
        @pointermove="move"
        @pointerup="stop"
        @pointercancel="stop"
        @lostpointercapture="stop"
        @keydown="keyboard($event, 'move')"
        @dblclick="run({ action: 'maximize', id })"
      >
        <span>{{ title }}</span
        ><svg class="drag-dots" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
        </svg>
      </button>
      <template v-if="id === 'tools'">
        <button
          class="window-control"
          type="button"
          aria-label="自动排列"
          title="自动排列"
          :disabled="!canArrange"
          @click="run({ action: 'arrange' })"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5h7v14H4zM14 5h6v5h-6zM14 13h6v6h-6z" />
          </svg>
        </button>
        <button
          class="window-control"
          type="button"
          aria-label="收起全部"
          title="收起全部"
          @click="run({ action: 'hide-all' })"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 9V4h14v5M3 12v6h18v-6M10 15h4" />
          </svg>
        </button>
      </template>
      <button
        class="window-control"
        type="button"
        :aria-label="`复位${title}面板`"
        title="复位位置和大小"
        @click="run({ action: 'reset', id })"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 10a8 8 0 1 1 0 4M4 4v6h6" />
        </svg>
      </button>
      <button
        class="window-control"
        type="button"
        :aria-label="maximized ? '还原面板' : '展开面板'"
        :title="maximized ? '还原大小' : '展开至工作区'"
        @click="run({ action: 'maximize', id })"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path :d="maximized ? 'M8 4h12v12M4 8h12v12H4z' : 'M4 4h16v16H4z'" />
        </svg>
      </button>
      <button
        class="window-control"
        type="button"
        :aria-label="`收起${title}面板`"
        title="收起面板（Esc），保留当前进度"
        @click="close"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7 7 10 10M17 7 7 17" />
        </svg>
      </button>
    </header>
    <p v-if="error" class="workspace-error" role="alert">{{ error }}</p>
    <div class="floating-content"><slot /></div>
    <button
      v-if="!maximized"
      class="panel-resize-handle"
      type="button"
      aria-label="调整面板大小，方向键微调"
      title="拖动调整大小 · 方向键微调"
      @pointerdown="start($event, 'resize')"
      @pointermove="move"
      @pointerup="stop"
      @pointercancel="stop"
      @lostpointercapture="stop"
      @keydown="keyboard($event, 'resize')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m8 18 10-10M14 18l4-4" />
      </svg>
    </button>
  </section>
</template>
