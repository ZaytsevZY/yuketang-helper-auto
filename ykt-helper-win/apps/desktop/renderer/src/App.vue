<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { RuntimeStatus } from '@ykt/contracts';

const status = ref<RuntimeStatus>();
const error = ref('');

onMounted(async () => {
  try {
    status.value = await window.yuketang.getRuntimeStatus();
  } catch {
    error.value = '无法连接后端运行时';
  }
});
</script>

<template>
  <main>
    <section class="card">
      <p class="eyebrow">YUKETANG HELPER</p>
      <h1>桌面迁移基线已就绪</h1>
      <p class="description">
        当前为 M0 架构壳，网页登录与课堂功能将在后续阶段接入。
      </p>
      <div class="status" :class="status?.state">
        <span class="dot" />
        <span v-if="status"
          >Backend {{ status.state }} · v{{ status.version }}</span
        >
        <span v-else-if="error">{{ error }}</span>
        <span v-else>正在连接 Backend…</span>
      </div>
    </section>
  </main>
</template>
