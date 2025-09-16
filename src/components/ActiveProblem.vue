<script setup>
import { ref, computed } from "vue";
import { PROBLEM_TYPE_MAP } from "@/util";

const props = defineProps([
  "problem",
  "status",
  "onShow",
  "onAnswer",
  "onCancel",
  "onDone",
]);

const currentTime = ref(Date.now());
setInterval(() => {
  currentTime.value = Date.now();
}, 500);

const state = computed(() => {
  if (props.problem.result) {
    return "answered";
  } else if (props.status.autoAnswerTime !== null) {
    return "ready";
  } else if (props.status.answering) {
    return "pending";
  } else if (currentTime.value >= props.status.endTime) {
    return "ended";
  } else {
    return "none";
  }
});

const canAnswer = computed(() => !["answered", "pending"].includes(state.value));

const answerBtnTitle = computed(() => {
  if (state.value === "ended") {
    return "重试作答";
  } else if (state.value === "ready") {
    return "立即作答";
  } else {
    return "自动作答";
  }
});

const tagText = computed(() => {
  switch (state.value) {
    case "answered": {
      return "已完成";
    }
    case "ready": {
      const ms = Math.max(0, props.status.autoAnswerTime - currentTime.value);
      return `${Math.floor(ms / 1000)} 秒后作答`;
    }
    case "pending": {
      return "作答中...";
    }
    case "ended": {
      return "已截止";
    }
    default: {
      const ms = Math.max(0, props.status.endTime - currentTime.value);
      const seconds = Math.floor(ms / 1000) % 60;
      const minutes = Math.floor(ms / 60000);
      return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    }
  }
});

function revealAnswers(problem) {
  const lines = [
    `类型：${PROBLEM_TYPE_MAP[problem.problemType] || "未知"}`,
    `题面：${problem.body || "无"}`,
  ];

  switch (problem.problemType) {
    // Multiple-choice
    case 1:
    case 2: {
      lines.push(`答案：${problem.answers.join("")}`);
      break;
    }

    // Fill-in-the-blank
    case 4: {
      lines.push(...problem.blanks.map((({ answers }, i) => `答案 ${i + 1}：${JSON.stringify(answers)}`)));
      break;
    }

    default:
      lines.push("无答案");
      break;
  }

  alert(lines.join("\n"));
}
</script>

<template>
  <div class="card">
    <slot></slot>
    <span class="tag" :class="state">
      {{ tagText }}<!--
      --><span class="icon-btn" title="取消作答" v-if="state === 'ready'" @click="props.onCancel?.()">
        <i class="fas fa-xmark"></i>
      </span><!--
      --><span class="icon-btn" title="关闭题目" v-if="state === 'answered'" @click="props.onDone?.()">
        <i class="fas fa-check"></i>
      </span>
    </span>
    <ul class="actions bottom">
      <li>
        <span class="icon-btn" title="查看答案" @click="revealAnswers(props.problem)">
          <i class="fas fa-eye"></i>
        </span>
      </li>
      <li>
        <span class="icon-btn" title="查看题目" @click="props.onShow?.()">
          <i class="fas fa-up-right-from-square"></i>
        </span>
      </li>
      <li>
        <span class="icon-btn"
          :class="{ disabled: !canAnswer }"
          :title="answerBtnTitle"
          @click="canAnswer && props.onAnswer?.()"
        >
          <i class="fas fa-pen"></i>
        </span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.card {
  height: 180px;
  background: #ffffff;
  border: 1px solid #bbbbbb;
  box-shadow: 0 1px 4px 3px rgba(0, 0, 0, .1);
  opacity: 0.9;
  z-index: 0;
  transition: all 0.2s ease;
}

.card:hover {
  box-shadow: 0 1px 4px 3px rgba(0, 0, 0, .15);
  opacity: 1;
  z-index: 1;
  transform: translateY(-3px);
}

.tag {
  position: absolute;
  bottom: 0;
  left: 0;
  display: inline-block;
  padding: 2px 4px;
  font-size: small;
  color: #ffffff;
  background: #666666cc;
}

.tag.ended {
  background: #ff1e00cc;
}

.tag.ready, .tag.pending {
  background: #005effcc;
}

.tag.answered {
  background: #1eb41ecc;
}

.tag>.icon-btn {
  color: #eeeeee;
}

.tag>.icon-btn:hover {
  color: #ffffff;
}

.actions {
  position: absolute;
  bottom: 4px;
  right: 5px;
  display: flex;
  flex-direction: row;
  gap: 3px;
}

.actions>.icon-btn {
  list-style: none;
}
</style>
