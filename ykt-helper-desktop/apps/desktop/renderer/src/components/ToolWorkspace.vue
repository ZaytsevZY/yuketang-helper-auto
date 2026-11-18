<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onMounted,
  onUnmounted,
  ref,
} from 'vue';
import {
  BrowserEnvironment,
  ToolPanelIds,
  type BrowserState,
  type RuntimeStatus,
  type ToolPanelAction,
  type ToolPanelId,
  type WorkspacePage,
} from '@ykt/contracts';
import FloatingPanel from './FloatingPanel.vue';
import { toolIcons, toolLabels } from '../tool-catalog';
import { assignmentCollection } from '../assignment-collection';
import { courseProgressCollection } from '../course-progress-collection';

const AssistantPanel = defineAsyncComponent(() =>
  import('./AssistantPanel.vue').then((module) => module.default),
);
const NetworkLab = defineAsyncComponent(() =>
  import('./NetworkLab.vue').then((module) => module.default),
);
const props = defineProps<{ panelId: ToolPanelId }>();
const browser = ref<BrowserState>();
const runtime = ref<RuntimeStatus>();
const error = ref('');
const profileAvailable = ref<boolean | null>(null);
const page = ref<WorkspacePage>(
  props.panelId === 'tools' || props.panelId === 'network'
    ? 'classroom'
    : props.panelId,
);
const previousPage = ref<WorkspacePage>();
const state = computed(() =>
  browser.value?.panels?.find((panel) => panel.id === props.panelId),
);
const tools = ToolPanelIds.filter((id) => id !== 'tools');
const opened = computed(
  () =>
    browser.value?.panels?.filter(
      (panel) => panel.visible && panel.id !== 'tools',
    ) ?? [],
);
const title = computed(() =>
  props.panelId === 'tools' || props.panelId === 'network'
    ? toolLabels[props.panelId]
    : toolLabels[page.value],
);
const activeComponent = computed(() =>
  props.panelId === 'network' ? NetworkLab : AssistantPanel,
);
const componentProps = computed(() =>
  props.panelId === 'network'
    ? {}
    : {
        page: page.value,
        environment: browser.value?.environment ?? BrowserEnvironment.Standard,
        runtime: runtime.value,
        browserUrl: browser.value?.url,
        collapsed: false,
        automationOwner: false,
        active: state.value?.visible ?? false,
      },
);
let unsubscribe: (() => void) | undefined;
const channel =
  typeof window.BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('ykt-profile-status');
if (channel)
  channel.onmessage = (event) => {
    if (typeof event.data === 'boolean') profileAvailable.value = event.data;
  };
function profiles(available: boolean): void {
  profileAvailable.value = available;
  channel?.postMessage(available);
}
async function control(command: ToolPanelAction): Promise<void> {
  try {
    error.value = '';
    await window.yuketang.controlToolPanel(command);
  } catch {
    error.value = '面板操作失败，请重试。';
  }
}
const open = (id: ToolPanelId) => control({ action: 'open', id });
const close = () => control({ action: 'close', id: props.panelId });
function selectPage(next: WorkspacePage): void {
  // Related actions (e.g. explaining an assignment) retain their local context.
  // Standalone tools are opened from the launcher into their own cached view.
  if (next !== page.value) previousPage.value = page.value;
  page.value = next;
}
onMounted(async () => {
  unsubscribe = window.yuketang.onBrowserStateChanged((value) => {
    browser.value = value;
  });
  try {
    [browser.value, runtime.value] = await Promise.all([
      window.yuketang.getBrowserState(),
      window.yuketang.getRuntimeStatus(),
    ]);
  } catch {
    error.value = '无法读取工作区状态，请重新打开工具。';
  }
  if (props.panelId === 'tools') {
    void assignmentCollection
      .initialize()
      .then(() => courseProgressCollection.initialize());
  } else if (props.panelId === 'assignments')
    void assignmentCollection.initialize();
});
onUnmounted(() => {
  unsubscribe?.();
  channel?.close();
});
</script>

<template>
  <FloatingPanel
    :id="panelId"
    :title="title"
    :state="state"
    :can-arrange="opened.length > 0"
    @launcher="open('tools')"
    @close="close"
  >
    <p v-if="error" class="workspace-error" role="alert">{{ error }}</p>
    <template v-if="panelId === 'tools'">
      <div class="tool-launcher">
        <p
          v-if="profileAvailable === false"
          class="profile-unavailable"
          role="status"
        >
          无可用 Profile
        </p>
        <nav class="tool-grid" aria-label="助手功能">
          <button
            v-for="id in tools"
            :key="id"
            type="button"
            :class="{ 'tool-open': opened.some((panel) => panel.id === id) }"
            :aria-pressed="opened.some((panel) => panel.id === id)"
            @click="open(id)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path :d="toolIcons[id]" />
            </svg>
            <span>{{ toolLabels[id] }}</span>
            <small
              v-if="browser?.panels?.find((panel) => panel.id === id)?.error"
              >加载失败，重试</small
            >
          </button>
        </nav>
        <footer class="launcher-footer">
          <span class="status-dot" />{{
            runtime?.state === 'running' ? '助手已连接' : '助手连接中'
          }}
        </footer>
      </div>
      <AssistantPanel
        class="background-owner"
        page="classroom"
        :environment="browser?.environment ?? BrowserEnvironment.Standard"
        :runtime="runtime"
        :browser-url="browser?.url"
        :collapsed="true"
        :automation-owner="true"
        @profile-availability="profiles"
        @select-page="open"
        @reveal-notice="open('tools')"
      />
    </template>
    <template v-else>
      <button
        v-if="previousPage"
        class="related-page-back"
        type="button"
        @click="
          page = previousPage;
          previousPage = undefined;
        "
      >
        返回{{ toolLabels[previousPage] }}
      </button>
      <KeepAlive>
        <component
          :is="activeComponent"
          v-bind="componentProps"
          @toggle="close"
          @select-page="selectPage"
          @profile-availability="profiles"
          @reveal-notice="open(panelId)"
        />
      </KeepAlive>
    </template>
  </FloatingPanel>
</template>
