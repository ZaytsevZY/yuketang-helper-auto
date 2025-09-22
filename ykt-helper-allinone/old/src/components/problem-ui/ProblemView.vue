<script setup>
import { ref, onActivated } from "vue";
import storage from "@/storage";
import AnswerReveal from "./AnswerReveal.vue";

const props = defineProps([
  "problem",
  "canAnswer",
  "onAnswer",
]);

const answerRevealed = ref(false);
const answerContent = ref("");

onActivated(() => {
  const { problemId, problemType } = props.problem;
  const problemAnswers = storage.getMap("auto-answer");
  const result = problemAnswers.get(problemId);

  answerContent.value = "";

  if (result) {
    switch (problemType) {
      case 1: case 2: case 3:
        if (Array.isArray(result))
          answerContent.value = result.join("");
        break;

      case 4:
        if (Array.isArray(result))
          answerContent.value = result.join("\n");
        break;

      case 5:
        if (result && typeof result.content === "string")
          answerContent.value = result.content;
        break;
    }
  }
});

function parseAnswer(problemType, content) {
  switch (problemType) {
    case 1: case 2: case 3:
      return content.split("").sort();

    case 4:
      return content.split("\n").filter(text => !!text);

    case 5:
      // { content: string, pics: { pic: string, thumb: string }[] }
      return { content, pics: [] };
  }
}

function updateAutoAnswer() {
  const { problemId, problemType } = props.problem;
  const content = answerContent.value;

  if (!content) {
    storage.alterMap("auto-answer", (map) => map.delete(problemId));

    $toast({
      message: "已重置本题的自动作答内容",
      duration: 3000
    });
  } else {
    const result = parseAnswer(problemType, content);
    storage.alterMap("auto-answer", (map) => map.set(problemId, result));

    $toast({
      message: "已设置本题的自动作答内容",
      duration: 3000
    });
  }
}

function handleAnswer() {
  const content = answerContent.value;
  const { problemType } = props.problem;

  props.onAnswer?.(content && parseAnswer(problemType, content));
}
</script>

<template>
  <div class="body">
    <p>
      题面：{{ props.problem.body || "空" }}
    </p>
    <AnswerReveal
      v-if="[1, 2, 4].includes(props.problem.problemType)"
      :problem="problem"
      :revealed="answerRevealed || !!props.problem.result"
      @reveal="answerRevealed = true"
    />
    <p v-if="props.problem.remark">
      备注：{{ props.problem.remark }}
    </p>
    <p v-if="Array.isArray(props.problem.remarkRich?.shapes)">
      <img v-for="shape in props.problem.remarkRich.shapes" :key="shape.id" :src="shape.url" />
    </p>
    <p v-if="props.problem.result">
      作答内容：<code>{{ JSON.stringify(props.problem.result) }}</code>
    </p>
    <textarea v-model="answerContent" rows="6" placeholder="自动作答内容"></textarea>
  </div>
  <div class="actions">
    <button @click="updateAutoAnswer()">自动作答</button>
    <button :disabled="!props.canAnswer" @click="handleAnswer()">提交答案</button>
  </div>
</template>

<style scoped>
.body {
  margin-top: 25px;
}

.body>textarea {
  width: 100%;
  min-height: 40px;
  resize: vertical;
}

.actions {
  margin-top: 25px;
  text-align: center;
}

.actions>button {
  margin: 0 20px;
  padding: 4px 10px;
}
</style>
