<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import {
  buildAssignmentDocument,
  ENCRYPTED_CLASS,
  loadAssignmentMath,
  type MathBundle,
} from '../assignment-body';

const props = defineProps<{ html: string; fontUrl: string | null }>();
const frame = ref<HTMLIFrameElement | null>(null);
const srcdoc = ref('');
const frameKey = ref(0);
const height = ref(120);
const warning = ref('');
const loading = ref(false);
let generation = 0;
let token = '';
let retried = false;
let bundle: MathBundle | null = null;
let images = new Set<string>(),
  links = new Set<string>();
let imagePending = new Set<string>();

function rebuild(data: string | null) {
  token = crypto.randomUUID();
  const built = buildAssignmentDocument(props.html, token, data, bundle);
  images = built.images;
  links = built.links;
  imagePending = new Set();
  height.value = 120;
  // Replace the browsing context: Chromium may keep the initial srcdoc document
  // if its attribute changes before the first navigation has committed.
  frameKey.value++;
  srcdoc.value = built.doc;
}

watch(
  () => [props.html, props.fontUrl],
  async () => {
    const seq = ++generation;
    warning.value = '';
    retried = false;
    loading.value = true;
    // Render immediately, even while resources are being fetched. A generation
    // change invalidates all old font/image completions and frame messages.
    bundle = null;
    rebuild(null);
    const needsFont = props.html.includes(ENCRYPTED_CLASS);
    const [math, font] = await Promise.all([
      /\$|\\[([]/.test(props.html)
        ? loadAssignmentMath()
        : Promise.resolve(null),
      needsFont && props.fontUrl
        ? window.yuketang
            .getAssignmentAsset(props.fontUrl, 'font')
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    if (seq !== generation) return;
    bundle = math;
    rebuild(font?.dataUrl ?? null);
    loading.value = false;
    if (needsFont && !font) warning.value = '部分文字加载失败，可在官网查看。';
  },
  { immediate: true },
);

async function onMessage(event: MessageEvent) {
  if (
    event.source !== frame.value?.contentWindow ||
    !event.data ||
    event.data.token !== token
  )
    return;
  const data = event.data,
    seq = generation,
    currentToken = token;
  if (
    data.type === 'height' &&
    typeof data.height === 'number' &&
    Number.isFinite(data.height)
  ) {
    height.value = Math.max(80, Math.min(20000, data.height + 8));
  } else if (
    data.type === 'link' &&
    typeof data.url === 'string' &&
    links.has(data.url)
  ) {
    await window.yuketang.openAssignmentLink(data.url).catch(() => {
      warning.value = '链接打开失败，请在官网查看。';
    });
  } else if (
    data.type === 'image' &&
    images.has(data.url) &&
    !imagePending.has(data.url)
  ) {
    const url: string = data.url;
    imagePending.add(url);
    const result = await window.yuketang
      .getAssignmentAsset(url, 'image')
      .catch(() => null);
    if (seq !== generation || token !== currentToken) return;
    frame.value?.contentWindow?.postMessage(
      { type: 'image-result', token, url, dataUrl: result?.dataUrl ?? null },
      '*',
    );
  } else if (data.type === 'font-failed') {
    if (loading.value) return;
    if (!retried && props.fontUrl) {
      retried = true;
      const font = await window.yuketang
        .getAssignmentAsset(props.fontUrl, 'font', true)
        .catch(() => null);
      if (seq !== generation || token !== currentToken) return;
      rebuild(font?.dataUrl ?? null);
      if (!font) warning.value = '部分文字加载失败，可在官网查看。';
    } else warning.value = '部分文字加载失败，可在官网查看。';
  } else if (data.type === 'font-ready') warning.value = '';
}

onMounted(() => window.addEventListener('message', onMessage));
onUnmounted(() => {
  generation++;
  token = '';
  window.removeEventListener('message', onMessage);
});
</script>

<template>
  <p v-if="loading" role="status">正在加载内容…</p>
  <p v-if="warning" class="body-warning" role="status">{{ warning }}</p>
  <iframe
    v-if="srcdoc"
    :key="frameKey"
    ref="frame"
    title="作业内容"
    sandbox="allow-scripts"
    referrerpolicy="no-referrer"
    :srcdoc="srcdoc"
    :style="{ height: `${height}px` }"
  />
</template>

<style scoped>
iframe {
  display: block;
  border: 0;
  width: 100%;
  background: #fff;
  border-radius: 8px;
}
.body-warning {
  padding: 8px;
  background: #fff3dc;
  color: #85570d;
  border-radius: 6px;
}
</style>
