<script setup>
const props = defineProps([
  "problem",
  "revealed",
  "onReveal",
]);
</script>

<template>
  <p v-if="!props.revealed">
    答案：<a href="#" @click.prevent="props.onReveal?.()">查看答案</a>
  </p>
  <template v-else-if="props.problem.problemType === 4">
    <p v-for="(blank, key) in props.problem.blanks">
      答案 {{ key + 1 }}：<code>{{ JSON.stringify(blank.answers) }}</code>
    </p>
  </template>
  <p v-else>
    答案：<code>{{ JSON.stringify(props.problem.answers) }}</code>
  </p>
</template>
