<script setup>
import { ref, computed, watch } from "vue";
import { jsPDF } from "jspdf";
import { coverStyle, PROBLEM_TYPE_MAP } from "@/util";

const props = defineProps([
  "presentation",
  "showAllSlides",
  "currentSlideId",
  "problemStatus",
  "onNavigate",
]);

const thumbStyle = computed(() => coverStyle(props.presentation));

const filteredSlides = computed(() => {
  const { slides } = props.presentation;
  return props.showAllSlides ? slides : slides.filter(slide => slide.problem);
});

function slideClass(slide) {
  const problem = slide.problem;
  return {
    active: slide.id === props.currentSlideId,
    ...problem && {
      unlocked: props.problemStatus.has(problem.problemId),
      answered: !!problem.result,
    }
  };
}

const slideRefs = new Map();
watch(() => props.currentSlideId, (id) => {
  const el = slideRefs.get(id);
  if (el) {
    requestAnimationFrame(() => {
      const containerBox = el.parentElement.getBoundingClientRect();
      const itemBox = el.getBoundingClientRect();
      // polyfill for scrollIntoViewIfNeeded
      if (itemBox.top < containerBox.top || itemBox.bottom > containerBox.bottom) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
  }
});

const downloadProgress = ref(null);

async function handleDownload() {
  try {
    $toast({
      message: "正在下载课件，可能需要一些时间...",
      duration: 3000
    });
    await savePresentation();
  } catch (err) {
    console.error(err);
    $toast({
      message: "下载失败：" + err.message,
      duration: 3000
    });
  } finally {
    downloadProgress.value = null;
  }
}

async function savePresentation() {
  const { presentation } = props;
  const { width, height } = presentation;

  const doc = new jsPDF({
    format: [width, height],
    orientation: width > height ? "l" : "p",
    unit: 'px',
    putOnlyUsedFonts: true,
    compress: true,
    hotfixes: ["px_scaling"],
  });
  doc.deletePage(1);

  let parent = null;

  for (const slide of presentation.slides) {
    downloadProgress.value = `${slide.index}/${presentation.slides.length}`;

    const resp = await fetch(slide.cover);
    const arrayBuffer = await resp.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    doc.addPage();
    doc.addImage(data, "PNG", 0, 0, width, height);

    const pageNumber = doc.getNumberOfPages();
    if (parent === null) {
      parent = doc.outline.add(null, presentation.title, { pageNumber });
    }

    let bookmark = `${slide.index}`;
    if (slide.note) {
      bookmark += `: ${slide.note}`;
    }
    if (slide.problem) {
      bookmark += ` - ${PROBLEM_TYPE_MAP[slide.problem.problemType]}`;
    }
    doc.outline.add(parent, bookmark, { pageNumber });
  }

  doc.save(presentation.title);
}
</script>

<template>
  <div class="title">
    {{ props.presentation.title }}
    <span v-if="downloadProgress" title="下载进度">
      ({{ downloadProgress }})
    </span>
    <i v-else class="download-btn fas fa-download" @click="handleDownload()"></i>
  </div>
  <div class="slide"
    v-for="slide in filteredSlides"
    :key="slide.id"
    :ref="el => slideRefs.set(slide.id, el)"
    :class="slideClass(slide)"
    @click="props.onNavigate?.(props.presentation.id, slide.id)"
  >
    <img :src="slide.thumbnail" :style="thumbStyle" />
    <span class="tag">{{ slide.index }}</span>
  </div>
</template>

<style scoped>
.title {
  font-weight: bold;
  overflow: hidden;
  margin: 10px 0;
}

.title:after {
  content: "";
  display: inline-block;
  height: 1px;
  background: #aaaaaa;
  position: relative;
  vertical-align: middle;
  width: 100%;
  left: 1em;
  margin-right: -100%;
}

.title .download-btn {
  cursor: pointer;
}

.slide {
  position: relative;
  margin: 10px 0;
  border: 2px solid #dddddd;
  cursor: pointer;
}

.slide>img {
  display: block;
  width: 100%;
}

.slide>.tag {
  position: absolute;
  top: 0;
  left: 0;
  display: inline-block;
  padding: 3px 5px;
  font-size: small;
  color: #f7f7f7;
  background: rgba(64, 64, 64, .4);
}

.slide.active {
  border-color: #2d70e7;
}

.slide.active>.tag {
  background: #2d70e7;
}

.slide.unlocked {
  border-color: #d7d48e;
}

.slide.unlocked.active {
  border-color: #e6cb2d;
}

.slide.unlocked.active>.tag {
  background: #e6cb2d;
}

.slide.answered {
  border-color: #8dd790;
}

.slide.answered.active {
  border-color: #4caf50;
}

.slide.answered.active>.tag {
  background: #4caf50;
}
</style>
