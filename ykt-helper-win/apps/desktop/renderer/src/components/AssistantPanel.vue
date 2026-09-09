<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from 'vue';
import {
  ProblemType,
  type AiProfileView,
  type AnswerProposal,
  type AppLogEntry,
  type AppSettings,
  type BrowserEnvironment,
  type ClassroomNotice,
  type ClassroomNoticeKind,
  type Lesson,
  type NetworkEntry,
  type Presentation,
  type ProblemContext,
  type RuntimeStatus,
  type SourceModuleId,
  type UserProfile,
  type ValidationResult,
} from '@ykt/contracts';

import ClassroomSimulator from './ClassroomSimulator.vue';
import ProblemPicker from './ProblemPicker.vue';
import { renderSimpleMarkdown } from '../simple-markdown';

type WorkspacePage =
  | 'classroom'
  | 'problems'
  | 'ai'
  | 'courseware'
  | 'profiles'
  | 'settings'
  | 'simulator'
  | 'diagnostics';

interface SettingsDraft {
  notifyProblems: boolean;
  notifyProblemStarts: boolean;
  notifyAssessmentPublishes: boolean;
  notifyCoursewarePublishes: boolean;
  notifyOtherPublishes: boolean;
  notifyLessonFinished: boolean;
  notifyAutoAnswerScheduled: boolean;
  notifyAutoAnswerStarted: boolean;
  notifyAutoAnswerSucceeded: boolean;
  notifyAutoAnswerFailed: boolean;
  notifyNative: boolean;
  notifyPopup: boolean;
  notifySound: boolean;
  notifyPopupDurationSeconds: number;
  notifyVolumePercent: number;
  customNotifyAudioSrc: string;
  customNotifyAudioName: string;
  autoJoinEnabled: boolean;
  llmAutoGenerate: boolean;
  llmManagedSubmit: boolean;
  autoAnswerDelaySeconds: number;
  autoAnswerRandomDelaySeconds: number;
  keepScreenAwake: boolean;
  aiAnalyzeLatestOnOpen: boolean;
  aiSlidePickPriority: boolean;
  iftex: boolean;
  showAllSlides: boolean;
  maxPresentations: number;
  cacheMaxMb: number;
  logRetentionDays: number;
}

interface AiConnectionDraft {
  baseUrl: string;
  apiKey: string;
}

type AiProviderId =
  'moonshot' | 'deepseek' | 'openai' | 'openrouter' | 'custom';

interface AiProviderPreset {
  id: AiProviderId;
  name: string;
  baseUrl?: string;
}

interface AiProfileSelectionDraft {
  model: string;
  visionModel: string;
  ocrModel: string;
  translationModel: string;
  temperature: string;
}

interface NoticeToast extends ClassroomNotice {
  readonly id: number;
}

interface AiChatMessage {
  readonly id: number;
  readonly role: 'user' | 'assistant';
  content: string;
  status: 'pending' | 'ready' | 'failed';
  proposal?: AnswerProposal;
}

interface AiChatSession {
  readonly id: string;
  readonly contextId: string;
  readonly problemId?: string;
  readonly imageUrls: readonly string[];
  readonly messages: AiChatMessage[];
  requestVersion: number;
  lastPrompt: string;
  lastAuto: boolean;
}

interface LogRow {
  id: number;
  level: AppLogEntry['level'];
  scope: string;
  message: string;
  timestamp: string;
  detailsText: string;
}

const props = defineProps<{
  page: WorkspacePage;
  environment: BrowserEnvironment;
  runtime: RuntimeStatus | undefined;
  browserUrl: string | undefined;
  collapsed: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  selectPage: [page: WorkspacePage];
}>();

const user = ref<UserProfile | null>(null);
const lessons = ref<readonly Lesson[]>([]);
const selectedLessonId = ref('');
const problems = ref<readonly ProblemContext[]>([]);
const selectedProblemId = ref('');
const autoFilledDrafts = new Map<
  string,
  { draft: string; proposal: AnswerProposal }
>();
let automaticAnalysisRunning = false;
const presentations = ref<readonly Presentation[]>([]);
const selectedPresentationId = ref('');
const selectedSlideId = ref('');
const slidePickerOpen = ref(false);
const aiSlideContextId = ref('');
const settings = ref<AppSettings>();
const settingsDraft = ref<SettingsDraft>();
const aiProfiles = ref<readonly AiProfileView[]>([]);
const aiProviderPresets: readonly AiProviderPreset[] = [
  {
    id: 'moonshot',
    name: 'Moonshot AI',
    baseUrl: 'https://api.moonshot.cn/v1',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  { id: 'custom', name: 'Custom（自定义）' },
];
const aiProviderId = ref<AiProviderId>('moonshot');
const customAiBaseUrl = ref('');
const aiConnectionDraft = ref<AiConnectionDraft>({
  baseUrl: 'https://api.moonshot.cn/v1',
  apiKey: '',
});
const aiProfileSelections = ref<Record<string, AiProfileSelectionDraft>>({});
const aiProposal = ref<AnswerProposal>();
const appliedProposalId = ref('');
const aiCustomPrompt = ref('');
const aiChatDraft = ref('');
const aiChatSessions = reactive(new Map<string, AiChatSession>());
const aiSlideSelection = ref<string[]>([]);
const logs = ref<readonly LogRow[]>([]);
const noticeToasts = ref<readonly NoticeToast[]>([]);
const entries = ref<NetworkEntry[]>([]);
const collectingLessonId = ref('');
const answerDraft = ref('');
const validation = ref<ValidationResult>();
const submissionMessage = ref('');
const confirmed = ref(false);
const ocrText = ref('');
const translatedText = ref('');
const targetLanguage = ref(
  navigator.language.toLowerCase().startsWith('zh')
    ? '中文'
    : navigator.language,
);
const busy = ref('');
const errorMessage = ref('');
const infoMessage = ref('');
const subscriptions: Array<() => void> = [];
const connectedLessonIds = new Set<string>();
const seenAvailableProblems = new Set<string>();
const scheduledProblems = new Map<string, ReturnType<typeof setTimeout>>();
let automationTimer: ReturnType<typeof setInterval> | undefined;
let automationRunning = false;
let lastAutoJoinAt = 0;
let nextNoticeToastId = 1;
let nextAiChatMessageId = 1;
const seenNotices = new Map<string, number>();

const selectedLesson = computed(() =>
  lessons.value.find((lesson) => lesson.id === selectedLessonId.value),
);

const selectedProblem = computed(() =>
  problems.value.find((problem) => problem.id === selectedProblemId.value),
);

const selectedPresentation = computed(() =>
  presentations.value.find(
    (presentation) => presentation.id === selectedPresentationId.value,
  ),
);

const selectedSlide = computed(() =>
  selectedPresentation.value?.slides.find(
    (slide) => slide.id === selectedSlideId.value,
  ),
);

const selectedAiImages = computed(() => {
  const chosen = new Set(aiSlideSelection.value);
  const images = presentations.value
    .flatMap((presentation) => presentation.slides)
    .filter((slide) => chosen.has(slide.id) && slide.imageUrl)
    .map((slide) => slide.imageUrl!);
  if (images.length) return images;
  const problem = selectedProblem.value;
  const problemImage = presentations.value
    .flatMap((presentation) => presentation.slides)
    .find((slide) => slide.id === problem?.slideId)?.imageUrl;
  const fallback = settings.value?.aiSlidePickPriority
    ? problemImage || selectedSlide.value?.imageUrl
    : selectedSlide.value?.imageUrl || problemImage;
  return fallback ? [fallback] : [];
});

const selectedAiImageSlides = computed(() => {
  const urls = new Set(selectedAiImages.value);
  return presentations.value
    .flatMap((presentation) => presentation.slides)
    .filter((slide) => slide.imageUrl && urls.has(slide.imageUrl))
    .slice(0, 6);
});

const currentAiContextId = computed(
  () => selectedProblemId.value || aiSlideContextId.value,
);

const currentAiSession = computed(() =>
  currentAiContextId.value
    ? aiChatSessions.get(currentAiContextId.value)
    : undefined,
);

const hasSlideQuestionContext = computed(
  () =>
    !selectedProblem.value &&
    Boolean(aiSlideContextId.value) &&
    selectedAiImages.value.length > 0,
);

const aiRequestPending = computed(() =>
  currentAiSession.value?.messages.some(
    (message) => message.status === 'pending',
  ),
);

const currentSourceEntries = computed(() => {
  const key =
    selectedProblemId.value ||
    selectedSlideId.value ||
    selectedPresentationId.value ||
    selectedLessonId.value;
  if (!key) return [];
  return entries.value
    .filter((entry) => entryHasIdentifier(entry, key))
    .slice(-5)
    .reverse();
});

const selectedLetters = computed(() =>
  answerDraft.value
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .split('')
    .filter((value) => /^[A-Z]$/.test(value)),
);

const canSubmit = computed(
  () => validation.value?.valid === true && confirmed.value && !busy.value,
);

const agentAutoSubmitEnabled = computed(
  () =>
    settings.value?.llmAutoGenerate === true &&
    settings.value.llmManagedSubmit === true,
);

const activeSlideIndex = computed(() =>
  selectedPresentation.value?.slides.findIndex(
    (slide) => slide.id === selectedSlideId.value,
  ),
);

const selectedPresentationSlideCount = computed(() => {
  const selected = new Set(aiSlideSelection.value);
  return (
    selectedPresentation.value?.slides.filter((slide) => selected.has(slide.id))
      .length ?? 0
  );
});

const sourceModules: ReadonlyArray<{
  id: SourceModuleId;
  label: string;
  path: string;
  description: string;
}> = [
  {
    id: 'renderer',
    label: '界面与交互',
    path: 'apps/desktop/renderer/src',
    description: '顶栏、助手面板、网络实验室与用户输入。',
  },
  {
    id: 'ipc',
    label: '受限桌面桥接',
    path: 'apps/desktop/preload/index.ts',
    description: '把受控操作暴露给本地 Vue 页面。',
  },
  {
    id: 'backend',
    label: '课堂与题目服务',
    path: 'packages/backend/src',
    description: '标准化课堂、课件、题目、校验与提交。',
  },
  {
    id: 'routing',
    label: 'HTTP / WS 路由',
    path: 'packages/routing/src',
    description: '浏览器流量收集、主动提交、会话与事件归一化。',
  },
  {
    id: 'storage',
    label: '持久化与缓存',
    path: 'packages/storage/src',
    description: '设置、用户、日志、课件文档与资源缓存。',
  },
];

onMounted(async () => {
  subscriptions.push(
    window.yuketang.onNetworkEntryAdded((entry) => {
      entries.value.push(entry);
      if (entries.value.length > 500) entries.value.shift();
    }),
    window.yuketang.onClassroomNotice((notice) => {
      void handleClassroomNotice(notice);
    }),
  );
  await loadWorkspace();
  automationTimer = setInterval(() => void automationTick(), 1000);
});

onUnmounted(() => {
  subscriptions.forEach((unsubscribe) => unsubscribe());
  if (automationTimer) clearInterval(automationTimer);
  for (const timer of scheduledProblems.values()) clearTimeout(timer);
});

watch(
  () => props.environment,
  async () => {
    selectedLessonId.value = '';
    collectingLessonId.value = '';
    aiSlideContextId.value = '';
    problems.value = [];
    presentations.value = [];
    await loadWorkspace();
  },
);

watch(selectedProblemId, (id, previousId) => {
  const saved = autoFilledDrafts.get(previousId);
  if (saved) saved.draft = answerDraft.value;
  if (id) aiSlideContextId.value = '';
  resetAnswer();
});
watch(
  () => props.page,
  (page) => {
    if (page === 'ai' && settings.value?.aiAnalyzeLatestOnOpen) {
      void analyzeLatestProblemOnOpen();
    }
  },
);
watch(answerDraft, () => {
  validation.value = undefined;
  confirmed.value = false;
  submissionMessage.value = '';
});
watch(
  () => settingsDraft.value?.llmAutoGenerate,
  (enabled) => {
    if (enabled === false && settingsDraft.value) {
      settingsDraft.value.llmManagedSubmit = false;
    }
  },
);

watch(selectedPresentationId, () => {
  selectedSlideId.value = selectedPresentation.value?.slides[0]?.id ?? '';
  aiSlideSelection.value = [];
  aiSlideContextId.value = '';
  slidePickerOpen.value = false;
  ocrText.value = '';
});

watch(selectedSlideId, () => {
  ocrText.value = '';
  translatedText.value = '';
});

async function loadWorkspace(): Promise<void> {
  clearMessages();
  const failed: string[] = [];
  const [
    settingsResult,
    profileResult,
    userResult,
    lessonResult,
    networkResult,
  ] = await Promise.allSettled([
    window.yuketang.getSettings(),
    window.yuketang.listAiProfiles(),
    window.yuketang.getUser(props.environment),
    window.yuketang.listLessons(),
    window.yuketang.getNetworkSnapshot(),
  ]);

  if (settingsResult.status === 'fulfilled') {
    applySettings(settingsResult.value);
  } else failed.push('设置');
  if (profileResult.status === 'fulfilled') applyProfiles(profileResult.value);
  else failed.push('AI Profile');
  if (userResult.status === 'fulfilled') user.value = userResult.value;
  else failed.push('用户信息');
  if (lessonResult.status === 'fulfilled') {
    lessons.value = lessonResult.value;
    if (!selectedLessonId.value) {
      selectedLessonId.value =
        lessonResult.value.find((lesson) => lesson.status === 'active')?.id ??
        lessonResult.value[0]?.id ??
        '';
    }
    if (selectedLessonId.value) {
      try {
        await loadLessonData();
      } catch {
        failed.push('课堂数据');
      }
    }
  } else failed.push('课堂列表');
  if (networkResult.status === 'fulfilled') {
    entries.value = [...networkResult.value.entries].slice(-500);
  } else failed.push('网络记录');
  if (failed.length) {
    errorMessage.value = `无法读取${failed.join('、')}，请重试。`;
  }
}

async function refreshClassroom(): Promise<void> {
  await run('refresh', async () => {
    const [nextUser] = await Promise.all([
      window.yuketang.refreshUser(props.environment),
      window.yuketang.refreshLessons(props.environment),
    ]);
    const nextLessons = await window.yuketang.listLessons();
    user.value = nextUser;
    lessons.value = nextLessons;
    selectedLessonId.value =
      nextLessons.find((lesson) => lesson.status === 'active')?.id ??
      nextLessons[0]?.id ??
      '';
    const activeCount = nextLessons.filter(
      (lesson) => lesson.status === 'active',
    ).length;
    const endedCount = nextLessons.filter(
      (lesson) => lesson.status === 'ended',
    ).length;
    infoMessage.value = activeCount
      ? `已找到 ${activeCount} 个进行中课堂`
      : endedCount
        ? `当前没有进行中的课堂，已保留 ${endedCount} 个结课课堂`
        : nextLessons.length
          ? `当前没有进行中的课堂，已找到 ${nextLessons.length} 个待开始课堂`
          : '尚未发现课堂';
  });
}

async function connectLesson(): Promise<void> {
  if (!selectedLessonId.value) return;
  await run('connect', async () => {
    await window.yuketang.connectLesson(
      props.environment,
      selectedLessonId.value,
    );
    connectedLessonIds.add(selectedLessonId.value);
    collectingLessonId.value = selectedLessonId.value;
    infoMessage.value = '已打开官方课堂，正在收集题目与课件';
    await loadLessonData();
  });
}

async function loadLessonData(): Promise<void> {
  if (!selectedLessonId.value) return;
  const [nextProblems, nextPresentations] = await Promise.all([
    window.yuketang.listProblems(selectedLessonId.value),
    window.yuketang.listPresentations(selectedLessonId.value),
  ]);
  problems.value = nextProblems;
  presentations.value = nextPresentations;
  if (!nextProblems.some((problem) => problem.id === selectedProblemId.value)) {
    selectedProblemId.value =
      nextProblems.find((problem) => problem.status === 'available')?.id ??
      nextProblems[0]?.id ??
      '';
  }
  if (
    !nextPresentations.some(
      (presentation) => presentation.id === selectedPresentationId.value,
    )
  ) {
    selectedPresentationId.value = nextPresentations[0]?.id ?? '';
  }
  if (
    collectingLessonId.value === selectedLessonId.value &&
    (nextProblems.length > 0 || nextPresentations.length > 0)
  ) {
    infoMessage.value = `已同步 ${nextPresentations.length} 份课件、${nextProblems.length} 道题目`;
    collectingLessonId.value = '';
  }
}

function setLesson(id: string): void {
  selectedLessonId.value = id;
  selectedPresentationId.value = '';
  selectedSlideId.value = '';
  aiSlideSelection.value = [];
  aiSlideContextId.value = '';
  slidePickerOpen.value = false;
  void run('lesson-data', loadLessonData);
}

function chooseOption(index: number): void {
  const problem = selectedProblem.value;
  if (!problem) return;
  const letter = String.fromCharCode(65 + index);
  if (problem.type !== ProblemType.MultipleChoice) {
    answerDraft.value = letter;
    return;
  }
  const next = new Set(selectedLetters.value);
  if (next.has(letter)) next.delete(letter);
  else next.add(letter);
  answerDraft.value = [...next].sort().join('');
}

function openProblemSlide(): void {
  const problem = selectedProblem.value;
  if (!problem) return;
  selectedPresentationId.value = problem.presentationId;
  selectedSlideId.value = problem.slideId;
  emit('selectPage', 'courseware');
}

async function validateAnswer(): Promise<void> {
  const problem = selectedProblem.value;
  if (!problem) return;
  await run('validate', async () => {
    validation.value = await window.yuketang.validateAnswer({
      problemId: problem.id,
      answer: answerDraft.value,
    });
    confirmed.value = false;
  });
}

async function submitAnswer(): Promise<void> {
  const problem = selectedProblem.value;
  if (!problem || !canSubmit.value) return;
  await run('submit', async () => {
    const result = await window.yuketang.submitAnswer({
      problemId: problem.id,
      answer: answerDraft.value,
      ...(appliedProposalId.value
        ? {
            proposalId: appliedProposalId.value,
            confirmedBy: 'user' as const,
          }
        : {}),
    });
    submissionMessage.value = result.proposalOutcome
      ? result.proposalOutcome.changed
        ? `已于 ${formatTime(result.submittedAt)} 提交，并记录对 AI 建议的修改`
        : `已于 ${formatTime(result.submittedAt)} 按 AI 建议提交`
      : `已于 ${formatTime(result.submittedAt)} 提交`;
    appliedProposalId.value = '';
    confirmed.value = false;
    await loadLessonData();
  });
}

function resetAnswer(): void {
  const saved =
    selectedProblem.value?.status === 'available'
      ? autoFilledDrafts.get(selectedProblemId.value)
      : undefined;
  const result = selectedProblem.value?.result;
  answerDraft.value = saved
    ? saved.draft
    : !result
      ? ''
      : Array.isArray(result)
        ? result.join('')
        : (result as { content: string }).content;
  validation.value = undefined;
  aiProposal.value = latestSessionProposal(currentAiSession.value);
  aiChatDraft.value = '';
  appliedProposalId.value = saved?.proposal.id ?? '';
  confirmed.value = false;
  submissionMessage.value = '';
}

function stepSlide(direction: -1 | 1): void {
  const presentation = selectedPresentation.value;
  const index = activeSlideIndex.value;
  if (!presentation || index === undefined || index < 0) return;
  const slide = presentation.slides[index + direction];
  if (slide) selectedSlideId.value = slide.id;
}

async function exportPdf(): Promise<void> {
  const presentation = selectedPresentation.value;
  if (!presentation) return;
  await run('pdf', async () => {
    const result = await window.yuketang.exportPresentationPdf(
      presentation.lessonId,
      presentation.id,
    );
    if (result) infoMessage.value = `PDF 已导出：${result.filePath}`;
  });
}

async function copySlideUrl(): Promise<void> {
  if (!selectedSlide.value?.imageUrl) return;
  await run('copy', async () => {
    await navigator.clipboard.writeText(selectedSlide.value?.imageUrl ?? '');
    infoMessage.value = '图片地址已复制';
  });
}

async function downloadCurrentSlide(): Promise<void> {
  const slide = selectedSlide.value;
  if (!slide?.imageUrl) return;
  await run('download-slide', async () => {
    const result = await window.yuketang.downloadSlide(
      slide.imageUrl!,
      slide.title || `课件第 ${(activeSlideIndex.value ?? 0) + 1} 页`,
    );
    if (result) infoMessage.value = `图片已保存：${result.filePath}`;
  });
}

function selectSlide(event: MouseEvent, id: string): void {
  if (!event.ctrlKey) {
    selectedSlideId.value = id;
    aiSlideSelection.value = [id];
    return;
  }
  const next = new Set(aiSlideSelection.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  aiSlideSelection.value = [...next];
}

function deselectSlide(id: string): void {
  aiSlideSelection.value = aiSlideSelection.value.filter(
    (selectedId) => selectedId !== id,
  );
}

function clearAiSlideSelection(): void {
  aiSlideSelection.value = [];
  if (aiSlideContextId.value) aiSlideContextId.value = '';
}

function openAiForSelectedSlides(): void {
  if (!aiSlideSelection.value.length && selectedSlideId.value) {
    aiSlideSelection.value = [selectedSlideId.value];
  }
  const slideIds = [...aiSlideSelection.value];
  const slideProblem =
    slideIds.length === 1
      ? problems.value.find((problem) => problem.slideId === slideIds[0])
      : undefined;
  selectedProblemId.value = slideProblem?.id ?? '';
  aiSlideContextId.value = slideProblem
    ? ''
    : `slides:${selectedPresentationId.value}:${slideIds.join(',')}`;
  aiCustomPrompt.value = '';
  emit('selectPage', 'ai');
}

async function recognizeCurrentSlide(): Promise<void> {
  const imageUrl = selectedSlide.value?.imageUrl;
  if (!imageUrl) return;
  await run('ocr', async () => {
    const result = await window.yuketang.recognizeSlide({ imageUrl });
    ocrText.value = result.text;
    translatedText.value = '';
    infoMessage.value = `已使用 ${result.model} 识别`;
  });
}

async function translateOcrText(): Promise<void> {
  if (!ocrText.value.trim()) return;
  await run('translation', async () => {
    const result = await window.yuketang.translateText({
      text: ocrText.value,
      targetLanguage: targetLanguage.value,
    });
    translatedText.value = result.text;
    infoMessage.value = `已使用 ${result.model} 翻译`;
  });
}

async function analyzeProblem(auto: boolean): Promise<void> {
  const problem = selectedProblem.value;
  const contextId = problem?.id ?? aiSlideContextId.value;
  if (!contextId) return;
  const customPrompt = auto ? '' : aiCustomPrompt.value.trim();
  if (!problem && !customPrompt) {
    errorMessage.value = '请输入要询问的课件问题。';
    return;
  }
  const prompt = customPrompt || '分析这道题并给出答案建议。';
  await requestAiProposal(problem, contextId, prompt, auto, false);
}

async function analyzeLatestProblemOnOpen(): Promise<void> {
  const latest = problems.value
    .filter(
      (problem) =>
        problem.status === 'available' &&
        (!problem.deadlineAt || problem.deadlineAt > Date.now()),
    )
    .sort((left, right) => (left.unlockedAt ?? 0) - (right.unlockedAt ?? 0))
    .at(-1);
  if (!latest) return;
  selectedProblemId.value = latest.id;
  aiSlideSelection.value = [];
  await nextTick();
  if (!aiChatSessions.has(latest.id)) await analyzeProblem(false);
}

async function sendAiFollowUp(): Promise<void> {
  const problem = selectedProblem.value;
  const session = currentAiSession.value;
  const prompt = aiChatDraft.value.trim();
  if (!session || !prompt || aiRequestPending.value) return;
  aiChatDraft.value = '';
  await requestAiProposal(problem, session.contextId, prompt, false, false);
}

async function retryAiRequest(): Promise<void> {
  const problem = selectedProblem.value;
  const session = currentAiSession.value;
  if (!session) return;
  await requestAiProposal(
    problem,
    session.contextId,
    session.lastPrompt,
    session.lastAuto,
    true,
  );
}

function startNewAiChat(): void {
  const contextId = currentAiContextId.value;
  if (!contextId || aiRequestPending.value) return;
  aiChatSessions.delete(contextId);
  aiProposal.value = undefined;
  appliedProposalId.value = '';
  aiCustomPrompt.value = '';
  aiChatDraft.value = '';
}

async function requestAiProposal(
  problem: ProblemContext | undefined,
  contextId: string,
  prompt: string,
  auto: boolean,
  retry: boolean,
): Promise<void> {
  const managedSubmitAtStart = agentAutoSubmitEnabled.value;
  clearMessages();
  let session = aiChatSessions.get(contextId);
  if (!session) {
    aiChatSessions.set(contextId, {
      id: crypto.randomUUID(),
      contextId,
      ...(problem ? { problemId: problem.id } : {}),
      imageUrls: [...selectedAiImages.value],
      messages: [],
      requestVersion: 0,
      lastPrompt: prompt,
      lastAuto: auto,
    });
    session = aiChatSessions.get(contextId)!;
  }

  if (retry) {
    const latestAssistantIndex = lastAssistantIndex(session.messages);
    if (latestAssistantIndex >= 0) {
      session.messages.splice(latestAssistantIndex, 1);
    }
  } else {
    session.messages.push({
      id: nextAiChatMessageId++,
      role: 'user',
      content: prompt,
      status: 'ready',
    });
  }

  session.lastPrompt = prompt;
  session.lastAuto = auto;
  session.requestVersion += 1;
  const requestVersion = session.requestVersion;
  session.messages.push({
    id: nextAiChatMessageId++,
    role: 'assistant',
    content: '正在分析题目与上下文…',
    status: 'pending',
  });
  const pendingMessage = session.messages[session.messages.length - 1]!;
  aiProposal.value = undefined;

  if (auto && problem) {
    void emitLocalNotice(
      'auto-answer-started',
      problem,
      'Agent 开始作答',
      problem.prompt || '正在分析新题',
    );
  }

  let proposal: AnswerProposal;
  try {
    const imageUrls =
      retry || session.messages.length === 2 ? [...session.imageUrls] : [];
    proposal = await window.yuketang.generateAnswerProposal({
      ...(session.problemId
        ? { problemId: session.problemId }
        : { contextId: session.contextId }),
      imageUrls,
      customPrompt: prompt,
      sessionId: session.id,
      retry,
    });
  } catch (error) {
    if (session.requestVersion !== requestVersion) return;
    pendingMessage.status = 'failed';
    pendingMessage.content = errorText(error);
    if (auto && problem) {
      await emitLocalNotice(
        'auto-answer-failed',
        problem,
        'Agent 未提交答案',
        pendingMessage.content,
      );
    }
    return;
  }

  if (session.requestVersion !== requestVersion) return;
  pendingMessage.proposal = proposal;
  pendingMessage.status = proposal.status;
  pendingMessage.content = proposalResponseText(proposal);
  if (currentAiContextId.value === contextId) aiProposal.value = proposal;

  if (!auto) {
    infoMessage.value =
      proposal.status === 'ready'
        ? 'AI 已回复，可继续追问或采用建议。'
        : proposal.failureReason || '没有生成可用的 AI 建议。';
    return;
  }

  if (!problem) return;
  if (managedSubmitAtStart && agentAutoSubmitEnabled.value) {
    await applyAutomaticProposal(problem, proposal);
    return;
  }
  const current = problems.value.find((item) => item.id === problem.id);
  if (
    selectedLessonId.value !== problem.lessonId ||
    current?.status !== 'available' ||
    (current.deadlineAt && current.deadlineAt <= Date.now())
  )
    return;
  if (proposal.status === 'ready' && proposal.answer) {
    const draft = answerValueToDraft(proposal.answer, problem.type);
    autoFilledDrafts.set(problem.id, { draft, proposal });
    if (selectedProblemId.value === problem.id) {
      answerDraft.value = draft;
      appliedProposalId.value = proposal.id;
      validation.value = undefined;
      confirmed.value = false;
      submissionMessage.value = '';
      emit('selectPage', 'problems');
    }
  }
  infoMessage.value =
    proposal.status === 'ready'
      ? 'LLM 已填入答案，尚未提交，等待手动核对、校验并确认提交。'
      : proposal.failureReason || 'LLM 未生成可用答案。';
  await emitLocalNotice(
    proposal.status === 'ready'
      ? 'auto-answer-succeeded'
      : 'auto-answer-failed',
    problem,
    proposal.status === 'ready' ? 'LLM 已生成答案' : 'LLM 生成答案失败',
    infoMessage.value,
  );
}

async function applyAutomaticProposal(
  problem: ProblemContext,
  proposal: AnswerProposal,
): Promise<void> {
  if (proposal.status !== 'ready' || !proposal.answer) {
    infoMessage.value = proposal.failureReason || '没有生成可提交的 AI 答案。';
    await emitLocalNotice(
      'auto-answer-failed',
      problem,
      'Agent 未提交答案',
      infoMessage.value,
    );
    return;
  }

  const proposalValidation = await window.yuketang.validateAnswer({
    problemId: problem.id,
    answer: proposal.answer,
    proposalId: proposal.id,
    confirmedBy: 'agent',
  });
  if (selectedProblemId.value === problem.id) {
    answerDraft.value = answerValueToDraft(proposal.answer, problem.type);
    appliedProposalId.value = proposal.id;
    validation.value = proposalValidation;
  }
  if (!proposalValidation.valid) {
    infoMessage.value = `Agent 未提交：${proposalValidation.issues.join('；')}`;
    await emitLocalNotice(
      'auto-answer-failed',
      problem,
      'Agent 未提交答案',
      infoMessage.value,
    );
    return;
  }

  if (!agentAutoSubmitEnabled.value) {
    infoMessage.value = 'LLM 已生成答案，托管提交已关闭。';
    return;
  }

  const result = await window.yuketang.submitAnswer({
    problemId: problem.id,
    answer: proposal.answer,
    proposalId: proposal.id,
    confirmedBy: 'agent',
  });
  if (selectedProblemId.value === problem.id) appliedProposalId.value = '';
  submissionMessage.value = `Agent 已于 ${formatTime(result.submittedAt)} 自动提交`;
  infoMessage.value = 'Agent 已自动确认并提交答案';
  await loadLessonData();
  await emitLocalNotice(
    'auto-answer-succeeded',
    problem,
    'Agent 已提交答案',
    `${problemTypeLabel(problem.type)}已由模型完成并提交。`,
  );
}

function proposalResponseText(proposal: AnswerProposal): string {
  return (
    proposal.failureReason ||
    proposal.explanation ||
    proposal.rawText ||
    '模型没有返回可显示的内容。'
  );
}

function latestSessionProposal(
  session: AiChatSession | undefined,
): AnswerProposal | undefined {
  if (!session) return undefined;
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const proposal = session.messages[index]?.proposal;
    if (proposal) return proposal;
  }
  return undefined;
}

function isLatestAssistantMessage(message: AiChatMessage): boolean {
  const messages = currentAiSession.value?.messages ?? [];
  return messages[lastAssistantIndex(messages)]?.id === message.id;
}

function lastAssistantIndex(messages: readonly AiChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return index;
  }
  return -1;
}

async function useProposal(): Promise<void> {
  const problem = selectedProblem.value;
  const answer = aiProposal.value?.answer;
  if (!problem || !answer) return;
  answerDraft.value = answerValueToDraft(answer, problem.type);
  appliedProposalId.value = aiProposal.value?.id ?? '';
  confirmed.value = false;
  emit('selectPage', 'problems');
  await validateAnswer();
}

function answerValueToDraft(
  answer: NonNullable<AnswerProposal['answer']>,
  type: ProblemContext['type'],
): string {
  if (!Array.isArray(answer)) return (answer as { content: string }).content;
  return type === ProblemType.FillBlank ? answer.join('\n') : answer.join('');
}

function proposalAnswerText(proposal: AnswerProposal): string {
  if (!proposal.answer) return '—';
  if (Array.isArray(proposal.answer)) return proposal.answer.join(' / ');
  return (proposal.answer as { content: string }).content;
}

function confidenceText(value: number | null): string {
  return value === null ? '置信度未知' : `置信度 ${Math.round(value * 100)}%`;
}

async function saveSettings(): Promise<void> {
  const draft = settingsDraft.value;
  if (!draft) return;
  const wasAutoGenerateEnabled = settings.value?.llmAutoGenerate === true;
  await run('settings', async () => {
    const next = await window.yuketang.updateSettings({
      notifyProblems: draft.notifyProblems,
      notifyProblemStarts: draft.notifyProblemStarts,
      notifyAssessmentPublishes: draft.notifyAssessmentPublishes,
      notifyCoursewarePublishes: draft.notifyCoursewarePublishes,
      notifyOtherPublishes: draft.notifyOtherPublishes,
      notifyLessonFinished: draft.notifyLessonFinished,
      notifyAutoAnswerScheduled: draft.notifyAutoAnswerScheduled,
      notifyAutoAnswerStarted: draft.notifyAutoAnswerStarted,
      notifyAutoAnswerSucceeded: draft.notifyAutoAnswerSucceeded,
      notifyAutoAnswerFailed: draft.notifyAutoAnswerFailed,
      notifyNative: draft.notifyNative,
      notifyPopup: draft.notifyPopup,
      notifySound: draft.notifySound,
      notifyPopupDuration:
        clamp(draft.notifyPopupDurationSeconds, 2, 60) * 1000,
      notifyVolume: clamp(draft.notifyVolumePercent, 0, 100) / 100,
      customNotifyAudioSrc: draft.customNotifyAudioSrc,
      customNotifyAudioName: draft.customNotifyAudioName,
      autoJoinEnabled: draft.autoJoinEnabled,
      llmAutoGenerate: draft.llmAutoGenerate,
      llmManagedSubmit: draft.llmAutoGenerate && draft.llmManagedSubmit,
      autoAnswerDelay: clamp(draft.autoAnswerDelaySeconds, 1, 60) * 1000,
      autoAnswerRandomDelay:
        clamp(draft.autoAnswerRandomDelaySeconds, 0, 30) * 1000,
      keepScreenAwake: draft.keepScreenAwake,
      aiAnalyzeLatestOnOpen: draft.aiAnalyzeLatestOnOpen,
      aiSlidePickPriority: draft.aiSlidePickPriority,
      iftex: draft.iftex,
      showAllSlides: draft.showAllSlides,
      maxPresentations: clamp(draft.maxPresentations, 1, 50),
      cacheMaxBytes: clamp(draft.cacheMaxMb, 64, 4096) * 1024 * 1024,
      logRetentionDays: clamp(draft.logRetentionDays, 1, 365),
    });
    applySettings(next);
    infoMessage.value = '设置已保存';
  });
  if (!settings.value?.llmAutoGenerate) {
    for (const timer of scheduledProblems.values()) clearTimeout(timer);
    scheduledProblems.clear();
  } else if (!wasAutoGenerateEnabled) {
    for (const problem of problems.value) {
      if (problem.status === 'available')
        seenAvailableProblems.delete(problem.id);
    }
    void automationTick();
  }
}

function applySettings(value: AppSettings): void {
  settings.value = value;
  settingsDraft.value = {
    notifyProblems: value.notifyProblems,
    notifyProblemStarts: value.notifyProblemStarts,
    notifyAssessmentPublishes: value.notifyAssessmentPublishes,
    notifyCoursewarePublishes: value.notifyCoursewarePublishes,
    notifyOtherPublishes: value.notifyOtherPublishes,
    notifyLessonFinished: value.notifyLessonFinished,
    notifyAutoAnswerScheduled: value.notifyAutoAnswerScheduled,
    notifyAutoAnswerStarted: value.notifyAutoAnswerStarted,
    notifyAutoAnswerSucceeded: value.notifyAutoAnswerSucceeded,
    notifyAutoAnswerFailed: value.notifyAutoAnswerFailed,
    notifyNative: value.notifyNative,
    notifyPopup: value.notifyPopup,
    notifySound: value.notifySound,
    notifyPopupDurationSeconds: Math.round(value.notifyPopupDuration / 1000),
    notifyVolumePercent: Math.round(value.notifyVolume * 100),
    customNotifyAudioSrc: value.customNotifyAudioSrc,
    customNotifyAudioName: value.customNotifyAudioName,
    autoJoinEnabled: value.autoJoinEnabled,
    llmAutoGenerate: value.llmAutoGenerate,
    llmManagedSubmit: value.llmManagedSubmit,
    autoAnswerDelaySeconds: Math.round(value.autoAnswerDelay / 1000),
    autoAnswerRandomDelaySeconds: Math.round(
      value.autoAnswerRandomDelay / 1000,
    ),
    keepScreenAwake: value.keepScreenAwake,
    aiAnalyzeLatestOnOpen: value.aiAnalyzeLatestOnOpen,
    aiSlidePickPriority: value.aiSlidePickPriority,
    iftex: value.iftex,
    showAllSlides: value.showAllSlides,
    maxPresentations: value.maxPresentations,
    cacheMaxMb: Math.round(value.cacheMaxBytes / 1024 / 1024),
    logRetentionDays: value.logRetentionDays,
  };
}

async function resetSettings(): Promise<void> {
  if (!window.confirm('恢复默认设置会清除所有 AI API Key，是否继续？')) return;
  await run('settings-reset', async () => {
    applySettings(await window.yuketang.resetSettings());
    applyProfiles(await window.yuketang.listAiProfiles());
    infoMessage.value = '设置和 AI Profile 已恢复默认值';
  });
}

function applyProfiles(value: readonly AiProfileView[]): void {
  aiProfiles.value = value;
  aiProfileSelections.value = Object.fromEntries(
    value.map((profile) => [
      profile.id,
      {
        model: profile.model,
        visionModel: profile.visionModel,
        ocrModel: profile.ocrModel,
        translationModel: profile.translationModel,
        temperature:
          profile.temperature === null ? '' : String(profile.temperature),
      },
    ]),
  );
}

function changeAiProvider(event: Event): void {
  const nextProviderId = (event.target as HTMLSelectElement)
    .value as AiProviderId;
  if (aiProviderId.value === 'custom') {
    customAiBaseUrl.value = aiConnectionDraft.value.baseUrl;
  }
  aiProviderId.value = nextProviderId;
  aiConnectionDraft.value.baseUrl =
    aiProviderPresets.find((provider) => provider.id === nextProviderId)
      ?.baseUrl ?? customAiBaseUrl.value;
}

async function selectAiProfile(id: string): Promise<void> {
  await run('profile-select', async () => {
    if (settings.value)
      settings.value = { ...settings.value, activeAiProfileId: id };
    applyProfiles(await window.yuketang.selectAiProfile(id));
  });
}

async function connectAiProfile(): Promise<void> {
  const draft = aiConnectionDraft.value;
  await run('profile-connect', async () => {
    const profiles = await window.yuketang.connectAiProfile({
      providerId: 'openai-compatible',
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey,
    });
    settings.value = await window.yuketang.getSettings();
    applyProfiles(profiles);
    draft.apiKey = '';
    infoMessage.value = `已连接服务并发现 ${profiles.find((profile) => profile.id === settings.value?.activeAiProfileId)?.models.length ?? 0} 个模型`;
  });
}

async function refreshAiProfile(id: string): Promise<void> {
  await run(`profile-refresh-${id}`, async () => {
    applyProfiles(await window.yuketang.refreshAiProfile(id));
    infoMessage.value = '模型目录已刷新';
  });
}

async function saveAiProfileSelection(id: string): Promise<void> {
  const draft = aiProfileSelections.value[id];
  if (!draft) return;
  await run(`profile-model-${id}`, async () => {
    const temperature = draft.temperature.trim();
    const parsedTemperature = temperature === '' ? null : Number(temperature);
    if (
      parsedTemperature !== null &&
      (!Number.isFinite(parsedTemperature) ||
        parsedTemperature < 0 ||
        parsedTemperature > 2)
    ) {
      throw new Error('Temperature 必须是 0 到 2 之间的数字，或留空。');
    }
    applyProfiles(
      await window.yuketang.updateAiProfileSelection({
        id,
        model: draft.model,
        visionModel: draft.visionModel,
        ocrModel: draft.ocrModel,
        translationModel: draft.translationModel,
        temperature: parsedTemperature,
      }),
    );
    infoMessage.value = 'Profile 功能分工已更新';
  });
}

async function deleteAiProfile(id: string): Promise<void> {
  if (!window.confirm('删除此 AI 服务及其加密 API Key？')) return;
  await run('profile-delete', async () => {
    const profiles = await window.yuketang.deleteAiProfile(id);
    const active = profiles[0]?.id ?? '';
    if (settings.value)
      settings.value = { ...settings.value, activeAiProfileId: active };
    applyProfiles(profiles);
  });
}

function modelDetails(profile: AiProfileView, modelId: string): string {
  const model = profile.models.find((item) => item.id === modelId);
  if (!model) return '能力信息未知';
  const details = [
    model.inputModalities.includes('image') ? '图像' : '文本',
    model.contextWindow
      ? `${Math.round(model.contextWindow / 1000)}k 上下文`
      : '',
  ].filter(Boolean);
  return details.join(' · ') || '能力信息未知';
}

function profileHost(profile: AiProfileView): string {
  return new URL(profile.baseUrl).host;
}

async function handleNotifyAudioFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  const draft = settingsDraft.value;
  if (!file || !draft) return;
  if (file.size > 2 * 1024 * 1024) {
    errorMessage.value = '提示音文件不能超过 2MB。';
    return;
  }
  draft.customNotifyAudioSrc = await readFileAsDataUrl(file);
  draft.customNotifyAudioName = file.name;
  playNotifySound();
}

function clearNotifyAudio(): void {
  const draft = settingsDraft.value;
  if (!draft) return;
  draft.customNotifyAudioSrc = '';
  draft.customNotifyAudioName = '';
}

async function testNotification(): Promise<void> {
  await deliverNotice({
    kind: 'problem-start',
    lessonId: 'test',
    dedupeKey: `test:${Date.now()}`,
    title: '雨课堂提醒测试',
    detail: '已按当前提醒方式发送测试消息。',
    occurredAt: Date.now(),
  });
}

async function handleClassroomNotice(notice: ClassroomNotice): Promise<void> {
  const currentSettings = settings.value;
  if (!currentSettings?.notifyProblems || !noticeEnabled(notice.kind)) return;
  const previous = seenNotices.get(notice.dedupeKey);
  if (previous !== undefined && notice.occurredAt - previous < 60_000) return;
  seenNotices.set(notice.dedupeKey, notice.occurredAt);
  await deliverNotice(notice);
}

async function emitLocalNotice(
  kind: ClassroomNoticeKind,
  problem: ProblemContext,
  title: string,
  detail: string,
): Promise<void> {
  await handleClassroomNotice({
    kind,
    lessonId: problem.lessonId,
    dedupeKey: `${kind}:${problem.lessonId}:${problem.id}`,
    title,
    detail,
    occurredAt: Date.now(),
  });
}

async function deliverNotice(notice: ClassroomNotice): Promise<void> {
  const currentSettings = settings.value;
  if (!currentSettings) return;
  if (currentSettings.notifySound) playNotifySound();
  if (currentSettings.notifyNative) {
    await window.yuketang.showNotification(notice.title, notice.detail);
  }
  if (currentSettings.notifyPopup) {
    const toast: NoticeToast = { ...notice, id: nextNoticeToastId++ };
    noticeToasts.value = [...noticeToasts.value, toast].slice(-3);
    setTimeout(
      () => removeNoticeToast(toast.id),
      currentSettings.notifyPopupDuration,
    );
  }
}

function removeNoticeToast(id: number): void {
  noticeToasts.value = noticeToasts.value.filter((item) => item.id !== id);
}

function noticeEnabled(kind: ClassroomNoticeKind): boolean {
  const currentSettings = settings.value;
  if (!currentSettings) return false;
  return {
    'problem-start': currentSettings.notifyProblemStarts,
    'assessment-publish': currentSettings.notifyAssessmentPublishes,
    'courseware-publish': currentSettings.notifyCoursewarePublishes,
    'other-publish': currentSettings.notifyOtherPublishes,
    'lesson-finished': currentSettings.notifyLessonFinished,
    'auto-answer-scheduled': currentSettings.notifyAutoAnswerScheduled,
    'auto-answer-started': currentSettings.notifyAutoAnswerStarted,
    'auto-answer-succeeded': currentSettings.notifyAutoAnswerSucceeded,
    'auto-answer-failed': currentSettings.notifyAutoAnswerFailed,
  }[kind];
}

function playNotifySound(): void {
  const draft = settingsDraft.value;
  const volume = clamp(draft?.notifyVolumePercent ?? 60, 0, 100) / 100;
  const src = draft?.customNotifyAudioSrc.trim();
  if (src) {
    const audio = new Audio(src);
    audio.volume = volume;
    void audio.play().catch(() => playNotifyTone(volume));
  } else playNotifyTone(volume);
}

function playNotifyTone(volume: number): void {
  const context = new AudioContext();
  const gain = context.createGain();
  gain.gain.value = volume;
  gain.connect(context.destination);
  for (const [frequency, offset] of [
    [880, 0],
    [1318.51, 0.16],
  ] as const) {
    const oscillator = context.createOscillator();
    const toneGain = context.createGain();
    oscillator.frequency.value = frequency;
    toneGain.gain.setValueAtTime(0.001, context.currentTime + offset);
    toneGain.gain.exponentialRampToValueAtTime(
      0.7,
      context.currentTime + offset + 0.01,
    );
    toneGain.gain.exponentialRampToValueAtTime(
      0.001,
      context.currentTime + offset + 0.14,
    );
    oscillator.connect(toneGain);
    toneGain.connect(gain);
    oscillator.start(context.currentTime + offset);
    oscillator.stop(context.currentTime + offset + 0.16);
  }
  setTimeout(() => void context.close(), 500);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
    reader.addEventListener('error', () =>
      reject(new Error('无法读取提示音文件。')),
    );
    reader.readAsDataURL(file);
  });
}

async function automationTick(): Promise<void> {
  const currentSettings = settings.value;
  if (!currentSettings || automationRunning) return;
  automationRunning = true;
  try {
    const now = Date.now();
    if (currentSettings.autoJoinEnabled && now - lastAutoJoinAt >= 5000) {
      lastAutoJoinAt = now;
      const refreshedLessons = await window.yuketang.refreshLessons(
        props.environment,
      );
      lessons.value = await window.yuketang.listLessons();
      for (const lesson of refreshedLessons.filter(
        (item) => item.status === 'active',
      )) {
        if (connectedLessonIds.has(lesson.id)) continue;
        await window.yuketang.connectLesson(props.environment, lesson.id);
        connectedLessonIds.add(lesson.id);
        if (!selectedLessonId.value) selectedLessonId.value = lesson.id;
      }
    }
    if (
      !selectedLessonId.value ||
      !connectedLessonIds.has(selectedLessonId.value)
    )
      return;
    await loadLessonData();
    const nextProblems = problems.value;
    for (const problem of nextProblems) {
      if (
        problem.status !== 'available' ||
        seenAvailableProblems.has(problem.id) ||
        !currentSettings.llmAutoGenerate
      )
        continue;
      seenAvailableProblems.add(problem.id);
      await onAvailableProblem(problem);
    }
  } catch {
    // Background polling is reflected by the next explicit refresh or diagnostic log.
  } finally {
    automationRunning = false;
  }
}

async function onAvailableProblem(problem: ProblemContext): Promise<void> {
  const currentSettings = settings.value;
  if (!currentSettings) return;
  if (!currentSettings.llmAutoGenerate || scheduledProblems.has(problem.id))
    return;
  const delay =
    currentSettings.autoAnswerDelay +
    Math.floor(Math.random() * (currentSettings.autoAnswerRandomDelay + 1));
  const remaining = problem.deadlineAt
    ? problem.deadlineAt - Date.now()
    : Infinity;
  if (remaining <= delay) return;
  await emitLocalNotice(
    'auto-answer-scheduled',
    problem,
    'LLM 答案生成已排队',
    `${Math.ceil(delay / 1000)} 秒后开始分析。`,
  );
  const startAnalysis = async (): Promise<void> => {
    const current = problems.value.find((item) => item.id === problem.id);
    if (
      !settings.value?.llmAutoGenerate ||
      current?.status !== 'available' ||
      (current.deadlineAt && current.deadlineAt <= Date.now())
    ) {
      scheduledProblems.delete(problem.id);
      return;
    }
    if (busy.value || aiRequestPending.value || automaticAnalysisRunning) {
      scheduledProblems.set(
        problem.id,
        setTimeout(() => void startAnalysis(), 500),
      );
      return;
    }
    scheduledProblems.delete(problem.id);
    automaticAnalysisRunning = true;
    selectedProblemId.value = current.id;
    aiSlideSelection.value = [];
    try {
      await nextTick();
      await analyzeProblem(true);
    } finally {
      automaticAnalysisRunning = false;
    }
  };
  const timer = setTimeout(() => void startAnalysis(), delay);
  scheduledProblems.set(problem.id, timer);
}

async function refreshLogs(): Promise<void> {
  await run('logs', async () => {
    const result = await window.yuketang.listLogs(120);
    logs.value = result.map(toLogRow);
  });
}

async function openSource(id: SourceModuleId): Promise<void> {
  await run('source', () => window.yuketang.openSourceModule(id));
}

async function run(key: string, action: () => Promise<void>): Promise<void> {
  busy.value = key;
  clearMessages();
  try {
    await action();
  } catch (error) {
    errorMessage.value = errorText(error);
  } finally {
    busy.value = '';
  }
}

function clearMessages(): void {
  errorMessage.value = '';
  infoMessage.value = '';
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : '操作失败，请在诊断页查看记录';
}

function problemStatus(status: ProblemContext['status']): string {
  return {
    locked: '未开放',
    available: '可作答',
    answered: '已作答',
    expired: '已截止',
  }[status];
}

function problemTypeLabel(type: ProblemContext['type']): string {
  return {
    [ProblemType.SingleChoice]: '单选题',
    [ProblemType.MultipleChoice]: '多选题',
    [ProblemType.Poll]: '投票题',
    [ProblemType.FillBlank]: '填空题',
    [ProblemType.Subjective]: '主观题',
    [ProblemType.Unknown]: '未知题型',
  }[type];
}

function sourceTitle(entry: NetworkEntry): string {
  if (entry.kind === 'http') {
    return `${entry.method} ${shortUrl(entry.url)}`;
  }
  if (entry.kind === 'websocket') {
    return `${entry.direction.toUpperCase()} ${shortUrl(entry.url)}`;
  }
  return entry.eventType;
}

function sourceMeta(entry: NetworkEntry): string {
  if (entry.kind === 'http') {
    return `${entry.source} · ${entry.statusCode ?? '—'} · ${entry.durationMs ?? '—'} ms`;
  }
  if (entry.kind === 'websocket') return `${entry.source} · WebSocket`;
  return `${entry.source} · ${entry.normalizerId}`;
}

function entryHasIdentifier(entry: NetworkEntry, identifier: string): boolean {
  if (entry.kind === 'domain') {
    return valueHasIdentifier(entry.data, identifier);
  }
  if (entry.kind === 'websocket') {
    return payloadHasIdentifier(entry.payload, identifier);
  }
  try {
    const url = new URL(entry.url);
    const urlValues = [
      ...url.pathname.split('/').filter(Boolean).map(decodeURIComponent),
      ...url.searchParams.values(),
    ];
    return (
      urlValues.includes(identifier) ||
      payloadHasIdentifier(entry.body, identifier)
    );
  } catch {
    return payloadHasIdentifier(entry.body, identifier);
  }
}

function payloadHasIdentifier(
  payload: string | null,
  identifier: string,
): boolean {
  if (!payload) return false;
  try {
    return valueHasIdentifier(JSON.parse(payload) as unknown, identifier);
  } catch {
    return payload === identifier;
  }
}

function valueHasIdentifier(value: unknown, identifier: string): boolean {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value) === identifier;
  }
  if (Array.isArray(value)) {
    return value.some((item) => valueHasIdentifier(item, identifier));
  }
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).some((item) =>
    valueHasIdentifier(item, identifier),
  );
}

function shortUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return value;
  }
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function stringifyUnknown(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toLogRow(value: AppLogEntry): LogRow {
  const entry = value as unknown as {
    id: number;
    level: AppLogEntry['level'];
    scope: string;
    message: string;
    timestamp: string;
    details: unknown;
  };
  return {
    id: entry.id,
    level: entry.level,
    scope: entry.scope,
    message: entry.message,
    timestamp: entry.timestamp,
    detailsText: entry.details ? stringifyUnknown(entry.details) : '',
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number(value) || min)));
}
</script>

<template>
  <aside class="assistant-panel" :class="{ collapsed }">
    <button
      v-if="collapsed"
      type="button"
      class="panel-expand"
      aria-label="展开助手面板"
      @click="emit('toggle')"
    >
      展开助手
    </button>

    <template v-else>
      <header class="panel-header">
        <div>
          <strong>助手面板</strong>
          <span>{{ selectedLesson?.title || '未选择课堂' }}</span>
        </div>
        <button type="button" class="quiet-button" @click="emit('toggle')">
          收起
        </button>
      </header>

      <div v-if="errorMessage" class="panel-message error" role="alert">
        <span>{{ errorMessage }}</span>
        <button
          type="button"
          :disabled="busy === 'workspace'"
          @click="run('workspace', loadWorkspace)"
        >
          {{ busy === 'workspace' ? '重试中' : '重试' }}
        </button>
      </div>
      <p v-else-if="infoMessage" class="panel-message success" role="status">
        {{ infoMessage }}
      </p>

      <div class="panel-scroll">
        <section v-if="page === 'classroom'" class="panel-page">
          <div class="section-heading">
            <h2>当前课堂</h2>
            <button
              type="button"
              :disabled="busy === 'refresh'"
              @click="refreshClassroom"
            >
              {{ busy === 'refresh' ? '刷新中' : '刷新' }}
            </button>
          </div>

          <dl class="fact-list">
            <div>
              <dt>用户</dt>
              <dd>{{ user?.name || '尚未读取' }}</dd>
            </div>
            <div>
              <dt>环境</dt>
              <dd>{{ environment }}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>
                {{ runtime?.state === 'running' ? '后端运行中' : '连接中' }}
              </dd>
            </div>
          </dl>

          <div class="section-divider">
            <h3>课堂列表</h3>
            <span>{{ lessons.length }} 个</span>
          </div>
          <div v-if="lessons.length" class="selection-list">
            <label
              v-for="lesson in lessons"
              :key="lesson.id"
              class="selection-row"
              :class="{ selected: selectedLessonId === lesson.id }"
            >
              <input
                type="radio"
                name="lesson"
                :checked="selectedLessonId === lesson.id"
                @change="setLesson(lesson.id)"
              />
              <span>
                <strong>{{ lesson.title || `课堂 ${lesson.id}` }}</strong>
                <small>{{ lesson.id }} · {{ lesson.status }}</small>
              </span>
            </label>
          </div>
          <div v-else class="empty-state">
            <strong>还没有课堂数据</strong>
            <p>登录雨课堂后点击刷新。</p>
          </div>

          <button
            type="button"
            class="primary-button full-width"
            :disabled="!selectedLessonId || busy === 'connect'"
            @click="connectLesson"
          >
            {{ busy === 'connect' ? '正在连接' : '连接所选课堂' }}
          </button>

          <div class="section-divider">
            <h3>当前来源</h3>
            <span>HTTP / WS</span>
          </div>
          <div class="source-list">
            <article v-for="entry in currentSourceEntries" :key="entry.id">
              <span class="source-kind">{{
                entry.kind === 'websocket' ? 'WS' : entry.kind.toUpperCase()
              }}</span>
              <div>
                <strong>{{ sourceTitle(entry) }}</strong>
                <small>{{ sourceMeta(entry) }}</small>
              </div>
            </article>
            <p v-if="!currentSourceEntries.length" class="inline-empty">
              连接课堂后，这里会显示对应 API 或 WebSocket 事件。
            </p>
          </div>
        </section>

        <section v-else-if="page === 'problems'" class="panel-page">
          <div class="section-heading">
            <h2>题目</h2>
            <span class="count-badge">{{ problems.length }}</span>
          </div>

          <div class="field-label">
            <span>当前题目</span>
            <ProblemPicker
              v-model="selectedProblemId"
              :problems="problems"
              :presentations="presentations"
            />
          </div>

          <template v-if="selectedProblem">
            <div class="problem-context">
              <div class="context-meta">
                <span>{{ problemTypeLabel(selectedProblem.type) }}</span>
                <span :class="`status-${selectedProblem.status}`">
                  {{ problemStatus(selectedProblem.status) }}
                </span>
                <span>ID {{ selectedProblem.id }}</span>
              </div>
              <p>
                {{
                  selectedProblem.prompt || '该题没有文本题干，请查看中央网页。'
                }}
              </p>
            </div>
            <div class="problem-shortcuts">
              <button type="button" @click="openProblemSlide">
                查看所在课件页
              </button>
              <button type="button" @click="emit('selectPage', 'ai')">
                AI 分析
              </button>
            </div>

            <div v-if="selectedProblem.options.length" class="option-list">
              <button
                v-for="(option, index) in selectedProblem.options"
                :key="index"
                type="button"
                :class="{
                  selected: selectedLetters.includes(
                    String.fromCharCode(65 + index),
                  ),
                }"
                @click="chooseOption(index)"
              >
                <span>{{ String.fromCharCode(65 + index) }}</span>
                {{ option }}
              </button>
            </div>

            <label class="field-label">
              手工答案
              <textarea
                v-model="answerDraft"
                rows="3"
                :placeholder="
                  selectedProblem.type === ProblemType.FillBlank
                    ? '每行一个填空答案'
                    : '例如 A、AC，或输入文字答案'
                "
              />
            </label>

            <button
              type="button"
              class="secondary-button full-width"
              :disabled="!answerDraft.trim() || busy === 'validate'"
              @click="validateAnswer"
            >
              {{ busy === 'validate' ? '正在校验' : '校验答案' }}
            </button>

            <div
              v-if="validation"
              class="validation-result"
              :class="validation.valid ? 'valid' : 'invalid'"
            >
              <strong>{{
                validation.valid ? '校验通过' : '校验未通过'
              }}</strong>
              <p v-if="validation.issues.length">
                {{ validation.issues.join('；') }}
              </p>
              <p v-else>答案格式与当前题目状态均可提交。</p>
            </div>

            <div v-if="validation?.valid" class="submit-control">
              <label>
                <input v-model="confirmed" type="checkbox" />
                我已核对题目与答案，确认提交到雨课堂
              </label>
              <button
                type="button"
                class="primary-button full-width"
                :disabled="!canSubmit"
                @click="submitAnswer"
              >
                {{ busy === 'submit' ? '正在提交' : '确认提交' }}
              </button>
            </div>
            <p v-if="submissionMessage" class="inline-success">
              {{ submissionMessage }}
            </p>

            <div class="section-divider">
              <h3>题目来源</h3>
              <span>可追溯</span>
            </div>
            <div class="source-list">
              <article v-for="entry in currentSourceEntries" :key="entry.id">
                <span class="source-kind">{{
                  entry.kind === 'websocket' ? 'WS' : entry.kind.toUpperCase()
                }}</span>
                <div>
                  <strong>{{ sourceTitle(entry) }}</strong>
                  <small>{{ sourceMeta(entry) }}</small>
                </div>
              </article>
              <p v-if="!currentSourceEntries.length" class="inline-empty">
                当前标准化题目来自 Backend；开启深度捕获后可匹配原始 HTTP / WS
                记录。
              </p>
            </div>
          </template>
          <div v-else class="empty-state">
            <strong>尚未载入题目</strong>
            <p>先在“课堂”页连接课堂。</p>
          </div>
        </section>

        <section v-else-if="page === 'ai'" class="panel-page">
          <div class="section-heading">
            <h2>AI 分析</h2>
            <span class="count-badge">{{ selectedAiImages.length }} 图</span>
          </div>

          <div class="field-label">
            <span>{{
              hasSlideQuestionContext ? '课堂题目（可选）' : '当前题目'
            }}</span>
            <ProblemPicker
              v-model="selectedProblemId"
              :problems="problems"
              :presentations="presentations"
            />
          </div>

          <template v-if="selectedProblem || hasSlideQuestionContext">
            <div class="problem-context compact-context">
              <p v-if="selectedProblem">
                {{ selectedProblem.prompt || '题干主要位于课件图片中。' }}
              </p>
              <p v-else>课件图片问答</p>
              <small>
                {{
                  aiProfiles.find(
                    (profile) => profile.id === settings?.activeAiProfileId,
                  )?.name || 'default'
                }}
                ·
                {{
                  selectedAiImages.length
                    ? `${selectedAiImages.length} 张课件图${hasSlideQuestionContext ? ' · 使用 VLM' : ''}`
                    : '纯文本'
                }}
              </small>
            </div>

            <div v-if="aiSlideSelection.length" class="selected-source-row">
              <span>已选课件页：{{ aiSlideSelection.length }}</span>
              <button
                type="button"
                class="quiet-button"
                @click="clearAiSlideSelection"
              >
                清除
              </button>
            </div>

            <div
              v-if="hasSlideQuestionContext"
              class="ai-slide-preview"
              aria-label="将发送给 AI 的课件图片"
            >
              <img
                v-for="(slide, index) in selectedAiImageSlides"
                :key="slide.id"
                :src="slide.imageUrl!"
                :alt="slide.title || `待提问课件第 ${index + 1} 页`"
              />
            </div>

            <template v-if="!currentAiSession">
              <label class="field-label">
                {{ hasSlideQuestionContext ? '你的问题' : '补充要求（可选）' }}
                <textarea
                  v-model="aiCustomPrompt"
                  rows="3"
                  :placeholder="
                    hasSlideQuestionContext
                      ? '例如：请解释这一页中的公式和推导过程。'
                      : '例如：请用中文回答，并简要说明思路。'
                  "
                />
              </label>

              <button
                type="button"
                class="primary-button full-width"
                :disabled="
                  hasSlideQuestionContext &&
                  (!aiCustomPrompt.trim() || !selectedAiImages.length)
                "
                @click="analyzeProblem(false)"
              >
                {{ hasSlideQuestionContext ? '发送问题' : '发送题目' }}
              </button>
            </template>

            <div v-else class="ai-chat">
              <div class="ai-chat-heading">
                <div>
                  <strong>题目对话</strong>
                  <span>{{ currentAiSession.messages.length }} 条消息</span>
                </div>
                <button
                  type="button"
                  class="quiet-button"
                  :disabled="aiRequestPending"
                  @click="startNewAiChat"
                >
                  新对话
                </button>
              </div>

              <ol class="ai-message-list" aria-live="polite">
                <li
                  v-for="message in currentAiSession.messages"
                  :key="message.id"
                  class="ai-message"
                  :class="`is-${message.role}`"
                >
                  <div class="ai-message-label">
                    <strong>{{
                      message.role === 'user' ? 'User Request' : 'AI Response'
                    }}</strong>
                    <span v-if="message.status === 'pending'">请求中</span>
                    <span v-else-if="message.status === 'failed'">未完成</span>
                  </div>
                  <div
                    class="ai-message-body"
                    :class="{
                      pending: message.status === 'pending',
                      failed: message.status === 'failed',
                    }"
                  >
                    <template v-if="message.status === 'pending'">
                      <div class="thinking-row">
                        <span aria-hidden="true"><i></i><i></i><i></i></span>
                        <p>{{ message.content }}</p>
                      </div>
                      <p class="request-recovery">
                        若等待过久，可重新发起本次请求。
                      </p>
                    </template>
                    <!-- eslint-disable vue/no-v-html -- output is escaped by renderSimpleMarkdown -->
                    <template v-else-if="message.proposal">
                      <div
                        v-if="message.proposal.answer"
                        class="proposal-answer"
                      >
                        <span>{{
                          currentAiSession.problemId ? '建议答案' : '回答'
                        }}</span>
                        <strong v-if="currentAiSession.problemId">{{
                          proposalAnswerText(message.proposal)
                        }}</strong>
                        <div
                          v-else
                          class="ai-markdown"
                          v-html="
                            renderSimpleMarkdown(
                              proposalAnswerText(message.proposal),
                            )
                          "
                        ></div>
                      </div>
                      <div
                        v-if="message.proposal.explanation"
                        class="proposal-explanation ai-markdown"
                        v-html="
                          renderSimpleMarkdown(message.proposal.explanation)
                        "
                      ></div>
                      <div
                        v-if="message.proposal.failureReason"
                        class="proposal-failure"
                      >
                        <strong>{{ message.proposal.failureReason }}</strong>
                        <p v-if="message.proposal.validationIssues.length">
                          {{ message.proposal.validationIssues.join('；') }}
                        </p>
                      </div>
                      <div class="proposal-meta">
                        <span v-if="message.proposal.model">{{
                          message.proposal.model
                        }}</span>
                        <span v-if="currentAiSession.problemId">{{
                          confidenceText(message.proposal.confidence)
                        }}</span>
                      </div>
                      <details
                        v-if="
                          message.proposal.rawText && currentAiSession.problemId
                        "
                        class="proposal-raw"
                      >
                        <summary>查看模型原始输出</summary>
                        <pre>{{ message.proposal.rawText }}</pre>
                      </details>
                      <button
                        v-if="
                          isLatestAssistantMessage(message) &&
                          currentAiSession.problemId &&
                          message.proposal.status === 'ready' &&
                          message.proposal.answer
                        "
                        type="button"
                        class="secondary-button full-width"
                        @click="useProposal"
                      >
                        采用建议并前往核对
                      </button>
                    </template>
                    <!-- eslint-enable vue/no-v-html -->
                    <p v-else>{{ message.content }}</p>

                    <button
                      v-if="
                        message.role === 'assistant' &&
                        isLatestAssistantMessage(message)
                      "
                      type="button"
                      class="retry-request"
                      @click="retryAiRequest"
                    >
                      {{
                        message.status === 'pending' ? '重新请求' : '重新生成'
                      }}
                    </button>
                  </div>
                </li>
              </ol>

              <form class="ai-composer" @submit.prevent="sendAiFollowUp">
                <textarea
                  v-model="aiChatDraft"
                  rows="2"
                  aria-label="追问 AI"
                  placeholder="继续追问…"
                  :disabled="aiRequestPending"
                  @keydown.enter.exact.prevent="sendAiFollowUp"
                />
                <button
                  type="submit"
                  class="primary-button"
                  :disabled="!aiChatDraft.trim() || aiRequestPending"
                >
                  发送
                </button>
                <small>Enter 发送，Shift + Enter 换行</small>
              </form>
            </div>
            <p class="honest-note">
              {{
                hasSlideQuestionContext
                  ? '课件问答仅发送所选页面和你的问题，不会提交课堂答案。'
                  : agentAutoSubmitEnabled
                    ? '自动提交已启用。新题会由 Agent 分析、校验并直接提交。'
                    : '手动生成的建议仍需在“题目”页校验并确认。'
              }}
            </p>
          </template>
          <div v-else class="empty-state">
            <strong>尚未选择分析内容</strong>
            <p>选择一道课堂题目，或从“课件”页选择图片后提问。</p>
          </div>
        </section>

        <section v-else-if="page === 'courseware'" class="panel-page">
          <div class="section-heading">
            <h2>课件</h2>
            <button
              type="button"
              :disabled="!selectedPresentation || busy === 'pdf'"
              @click="exportPdf"
            >
              {{ busy === 'pdf' ? '导出中' : '导出 PDF' }}
            </button>
          </div>

          <label class="field-label">
            课件
            <select
              v-model="selectedPresentationId"
              :disabled="!presentations.length"
            >
              <option value="">选择课件</option>
              <option
                v-for="presentation in presentations"
                :key="presentation.id"
                :value="presentation.id"
              >
                {{ presentation.title || `课件 ${presentation.id}` }}
              </option>
            </select>
          </label>

          <template v-if="selectedPresentation">
            <div class="slide-stage">
              <img
                v-if="selectedSlide?.imageUrl"
                :src="selectedSlide.imageUrl"
                :alt="
                  selectedSlide.title ||
                  `课件第 ${(activeSlideIndex ?? 0) + 1} 页`
                "
              />
              <div v-else class="missing-slide">该页没有图片资源</div>
            </div>
            <div class="slide-controls">
              <button
                type="button"
                :disabled="!activeSlideIndex"
                @click="stepSlide(-1)"
              >
                上一页
              </button>
              <button
                type="button"
                class="slide-picker-toggle"
                :aria-expanded="slidePickerOpen"
                aria-controls="courseware-slide-picker"
                @click="slidePickerOpen = !slidePickerOpen"
              >
                <span>
                  第 {{ (activeSlideIndex ?? 0) + 1 }} /
                  {{ selectedPresentation.slides.length }} 页
                </span>
                <span class="slide-picker-summary">
                  {{
                    selectedPresentationSlideCount
                      ? `已选 ${selectedPresentationSlideCount}`
                      : '选择页面'
                  }}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 12 12"
                    :class="{ open: slidePickerOpen }"
                  >
                    <path d="m2.25 4.25 3.75 3.5 3.75-3.5" />
                  </svg>
                </span>
              </button>
              <button
                type="button"
                :disabled="
                  activeSlideIndex === undefined ||
                  activeSlideIndex >= selectedPresentation.slides.length - 1
                "
                @click="stepSlide(1)"
              >
                下一页
              </button>
            </div>
            <section
              v-if="slidePickerOpen"
              id="courseware-slide-picker"
              class="slide-picker-panel"
              aria-label="课件页面选择"
              @keydown.esc="slidePickerOpen = false"
            >
              <header>
                <strong>全部页面</strong>
                <span>单击单选 · Ctrl + 单击多选 · 双击取消</span>
              </header>
              <div
                class="slide-thumbnail-list"
                role="listbox"
                aria-label="课件页面"
                aria-multiselectable="true"
              >
                <button
                  v-for="(slide, index) in selectedPresentation.slides"
                  :key="slide.id"
                  type="button"
                  class="slide-thumbnail"
                  :class="{
                    'is-current':
                      selectedLesson?.status !== 'ended' &&
                      slide.id === selectedSlideId,
                    'is-selected': aiSlideSelection.includes(slide.id),
                  }"
                  role="option"
                  :aria-selected="aiSlideSelection.includes(slide.id)"
                  :aria-current="
                    selectedLesson?.status !== 'ended' &&
                    slide.id === selectedSlideId
                      ? 'page'
                      : undefined
                  "
                  :title="slide.title || `第 ${index + 1} 页`"
                  @click="selectSlide($event, slide.id)"
                  @dblclick.prevent="deselectSlide(slide.id)"
                >
                  <span
                    class="slide-thumbnail-media"
                    :style="
                      selectedPresentation.width && selectedPresentation.height
                        ? {
                            aspectRatio: `${selectedPresentation.width} / ${selectedPresentation.height}`,
                          }
                        : undefined
                    "
                  >
                    <img
                      v-if="slide.imageUrl"
                      :src="slide.imageUrl"
                      :alt="slide.title || `课件第 ${index + 1} 页`"
                      loading="lazy"
                    />
                    <span v-else>无预览</span>
                  </span>
                  <span class="slide-thumbnail-meta">
                    <strong>第 {{ index + 1 }} 页</strong>
                    <span class="slide-thumbnail-states">
                      <span
                        v-if="
                          selectedLesson?.status !== 'ended' &&
                          slide.id === selectedSlideId
                        "
                        class="current-state"
                        >当前</span
                      >
                      <span
                        v-if="aiSlideSelection.includes(slide.id)"
                        class="selected-state"
                        >已选</span
                      >
                    </span>
                  </span>
                </button>
              </div>
            </section>
            <button
              type="button"
              class="quiet-action"
              :disabled="!selectedSlide?.imageUrl"
              @click="copySlideUrl"
            >
              复制当前图片地址
            </button>
            <div class="courseware-actions">
              <button
                type="button"
                :disabled="
                  !selectedSlide?.imageUrl || busy === 'download-slide'
                "
                @click="downloadCurrentSlide"
              >
                {{ busy === 'download-slide' ? '保存中' : '下载当前页' }}
              </button>
              <button
                type="button"
                :disabled="
                  !selectedSlide?.imageUrl && !selectedPresentationSlideCount
                "
                @click="openAiForSelectedSlides"
              >
                {{
                  selectedPresentationSlideCount > 1
                    ? `提问已选 ${selectedPresentationSlideCount} 页`
                    : '提问当前页'
                }}
              </button>
            </div>

            <div class="section-divider">
              <h3>文字工作区</h3>
              <span>OCR / 翻译</span>
            </div>
            <textarea
              v-model="ocrText"
              class="media-text"
              rows="6"
              placeholder="可在这里粘贴或整理课件文字。"
            />
            <div class="media-actions">
              <button
                type="button"
                :disabled="!selectedSlide?.imageUrl || busy === 'ocr'"
                @click="recognizeCurrentSlide"
              >
                {{ busy === 'ocr' ? '识别中' : '识别文字' }}
              </button>
              <button
                type="button"
                :disabled="
                  !ocrText.trim() ||
                  !targetLanguage.trim() ||
                  busy === 'translation'
                "
                @click="translateOcrText"
              >
                {{ busy === 'translation' ? '翻译中' : '翻译' }}
              </button>
            </div>
            <label class="field-label inline-field">
              目标语言
              <input
                v-model="targetLanguage"
                type="text"
                placeholder="例如：中文、English"
              />
            </label>
            <label v-if="translatedText" class="field-label">
              翻译结果
              <textarea
                v-model="translatedText"
                class="media-text"
                rows="6"
                readonly
              />
            </label>

            <div class="section-divider">
              <h3>课件来源</h3>
              <span>presentation API</span>
            </div>
            <div class="source-list">
              <article v-for="entry in currentSourceEntries" :key="entry.id">
                <span class="source-kind">{{
                  entry.kind === 'websocket' ? 'WS' : entry.kind.toUpperCase()
                }}</span>
                <div>
                  <strong>{{ sourceTitle(entry) }}</strong>
                  <small>{{ sourceMeta(entry) }}</small>
                </div>
              </article>
              <p v-if="!currentSourceEntries.length" class="inline-empty">
                课件由 Active Client 的 presentation API
                获取并写入本地文档缓存。
              </p>
            </div>
          </template>
          <div v-else class="empty-state">
            <strong>尚未载入课件</strong>
            <p>连接包含 presentationId 的课堂后即可浏览。</p>
          </div>
        </section>

        <section
          v-else-if="page === 'profiles'"
          class="panel-page profile-page"
        >
          <div class="section-heading">
            <h2>AI Profile</h2>
            <span class="count-badge">{{ aiProfiles.length }} 个</span>
          </div>

          <form class="profile-form" @submit.prevent="connectAiProfile">
            <fieldset class="profile-connect-panel">
              <legend>连接模型服务</legend>
              <div class="provider-connect">
                <label class="field-label">
                  模型厂商
                  <select :value="aiProviderId" @change="changeAiProvider">
                    <option
                      v-for="provider in aiProviderPresets"
                      :key="provider.id"
                      :value="provider.id"
                    >
                      {{ provider.name }}
                    </option>
                  </select>
                </label>
                <label class="field-label">
                  {{
                    aiProviderId === 'custom' ? 'Custom Base URL' : 'Base URL'
                  }}
                  <input
                    v-model="aiConnectionDraft.baseUrl"
                    type="url"
                    :readonly="aiProviderId !== 'custom'"
                    placeholder="https://api.example.com/v1"
                  />
                </label>
                <label class="field-label">
                  API Key
                  <input
                    v-model="aiConnectionDraft.apiKey"
                    type="password"
                    autocomplete="new-password"
                    placeholder="输入服务提供商的 API Key"
                  />
                </label>
                <button
                  type="submit"
                  class="primary-button full-width"
                  :disabled="
                    !aiConnectionDraft.baseUrl ||
                    !aiConnectionDraft.apiKey ||
                    busy === 'profile-connect'
                  "
                >
                  {{
                    busy === 'profile-connect'
                      ? '正在发现模型'
                      : '连接并获取模型'
                  }}
                </button>
              </div>
            </fieldset>

            <div class="section-divider profile-pool-heading">
              <h3>Profile Pool</h3>
              <span>{{ aiProfiles.length }} 个服务</span>
            </div>
            <div v-if="aiProfiles.length" class="profile-card-list">
              <article
                v-for="profile in aiProfiles"
                :key="profile.id"
                class="profile-card"
                :class="{
                  active: settings?.activeAiProfileId === profile.id,
                }"
              >
                <div class="profile-card-head">
                  <div>
                    <strong>{{ profile.name }}</strong>
                    <span>{{ profileHost(profile) }}</span>
                  </div>
                  <span class="profile-state">
                    {{
                      settings?.activeAiProfileId === profile.id
                        ? '当前 Profile'
                        : profile.hasApiKey
                          ? '已连接'
                          : '缺少密钥'
                    }}
                  </span>
                </div>
                <div class="profile-card-meta">
                  <span>{{ profile.models.length }} 个模型</span>
                  <span>来自 /models</span>
                </div>
                <div
                  v-if="aiProfileSelections[profile.id]"
                  class="profile-capabilities"
                >
                  <div class="capability-heading">
                    <strong>功能分工</strong>
                  </div>
                  <label class="capability-row">
                    <span>
                      <strong>LLM</strong>
                      <small>文字题与通用分析</small>
                    </span>
                    <select v-model="aiProfileSelections[profile.id]!.model">
                      <option
                        v-for="model in profile.models"
                        :key="model.id"
                        :value="model.id"
                      >
                        {{ model.name }}
                      </option>
                    </select>
                    <small class="model-hint">{{
                      modelDetails(
                        profile,
                        aiProfileSelections[profile.id]!.model,
                      )
                    }}</small>
                  </label>
                  <label class="capability-row">
                    <span>
                      <strong>VLM</strong>
                      <small>含图片的题目分析</small>
                    </span>
                    <select
                      v-model="aiProfileSelections[profile.id]!.visionModel"
                    >
                      <option
                        v-for="model in profile.models"
                        :key="model.id"
                        :value="model.id"
                      >
                        {{ model.name }}
                      </option>
                    </select>
                    <small class="model-hint">{{
                      modelDetails(
                        profile,
                        aiProfileSelections[profile.id]!.visionModel,
                      )
                    }}</small>
                  </label>
                  <label class="capability-row">
                    <span>
                      <strong>OCR</strong>
                      <small>提取课件文字</small>
                    </span>
                    <select v-model="aiProfileSelections[profile.id]!.ocrModel">
                      <option
                        v-for="model in profile.models"
                        :key="model.id"
                        :value="model.id"
                      >
                        {{ model.name }}
                      </option>
                    </select>
                    <small class="model-hint">{{
                      modelDetails(
                        profile,
                        aiProfileSelections[profile.id]!.ocrModel,
                      )
                    }}</small>
                  </label>
                  <label class="capability-row">
                    <span>
                      <strong>Translate</strong>
                      <small>翻译 OCR 与文本</small>
                    </span>
                    <select
                      v-model="
                        aiProfileSelections[profile.id]!.translationModel
                      "
                    >
                      <option
                        v-for="model in profile.models"
                        :key="model.id"
                        :value="model.id"
                      >
                        {{ model.name }}
                      </option>
                    </select>
                    <small class="model-hint">{{
                      modelDetails(
                        profile,
                        aiProfileSelections[profile.id]!.translationModel,
                      )
                    }}</small>
                  </label>
                  <label class="temperature-row">
                    <span>
                      <strong>Temperature</strong>
                      <small>留空使用模型默认值</small>
                    </span>
                    <input
                      v-model="aiProfileSelections[profile.id]!.temperature"
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      placeholder="默认"
                    />
                  </label>
                </div>
                <div class="profile-card-actions">
                  <button
                    type="button"
                    class="secondary-button"
                    :disabled="busy === `profile-model-${profile.id}`"
                    @click="saveAiProfileSelection(profile.id)"
                  >
                    保存分工
                  </button>
                  <button
                    v-if="settings?.activeAiProfileId !== profile.id"
                    type="button"
                    @click="selectAiProfile(profile.id)"
                  >
                    设为当前
                  </button>
                  <button
                    type="button"
                    :disabled="busy === `profile-refresh-${profile.id}`"
                    @click="refreshAiProfile(profile.id)"
                  >
                    刷新模型
                  </button>
                  <button
                    type="button"
                    class="danger-button"
                    @click="deleteAiProfile(profile.id)"
                  >
                    删除
                  </button>
                </div>
              </article>
            </div>
            <div v-else class="empty-state profile-empty">
              <strong>尚未连接 AI 服务</strong>
              <p>填写上方两项，验证成功后即可分配各项功能。</p>
            </div>
            <p class="credential-note profile-credential-note">
              API Key 仅进入系统加密凭据存储，不写入普通设置或日志。
            </p>
          </form>
        </section>

        <section v-else-if="page === 'simulator'" class="panel-page">
          <ClassroomSimulator />
        </section>

        <section v-else-if="page === 'settings'" class="panel-page">
          <div class="section-heading">
            <h2>设置</h2>
            <button
              type="button"
              :disabled="!settingsDraft || busy === 'settings'"
              @click="saveSettings"
            >
              {{ busy === 'settings' ? '保存中' : '保存' }}
            </button>
          </div>

          <form
            v-if="settingsDraft"
            class="settings-form"
            @submit.prevent="saveSettings"
          >
            <fieldset>
              <legend>课堂体验</legend>
              <label class="switch-row">
                <span>
                  <strong>自动进入正在上课的课堂</strong>
                  <small>每 5 秒检查一次，并在后台建立课堂连接。</small>
                </span>
                <input
                  v-model="settingsDraft.autoJoinEnabled"
                  type="checkbox"
                />
              </label>
              <label class="switch-row">
                <span>
                  <strong>LLM 自动生成答案</strong>
                  <small
                    >检测到新题后自动生成答案；是否提交由下一项决定。</small
                  >
                </span>
                <input
                  v-model="settingsDraft.llmAutoGenerate"
                  type="checkbox"
                />
              </label>
              <label
                class="switch-row"
                :class="{
                  'agent-submit-row': settingsDraft.llmManagedSubmit,
                }"
              >
                <span>
                  <strong>LLM 托管提交答案</strong>
                  <small
                    >生成成功后由 Agent
                    校验并提交；关闭时自动填入答案草稿，等待手动核对提交。</small
                  >
                </span>
                <input
                  v-model="settingsDraft.llmManagedSubmit"
                  type="checkbox"
                  :disabled="!settingsDraft.llmAutoGenerate"
                />
              </label>
              <label class="switch-row">
                <span>
                  <strong>课堂期间保持屏幕常亮</strong>
                  <small>仅当前标签处于课堂页面时阻止屏幕休眠。</small>
                </span>
                <input
                  v-model="settingsDraft.keepScreenAwake"
                  type="checkbox"
                />
              </label>
              <div class="paired-number-rows">
                <label class="number-row">
                  <span>生成延迟（秒）</span>
                  <input
                    v-model.number="settingsDraft.autoAnswerDelaySeconds"
                    type="number"
                    min="1"
                    max="60"
                  />
                </label>
                <label class="number-row">
                  <span>随机延迟（秒）</span>
                  <input
                    v-model.number="settingsDraft.autoAnswerRandomDelaySeconds"
                    type="number"
                    min="0"
                    max="30"
                  />
                </label>
              </div>
              <label class="switch-row">
                <span>
                  <strong>打开 AI 页时默认分析最新题</strong>
                  <small>自动选择最新可作答题；已有对话时不会重复请求。</small>
                </span>
                <input
                  v-model="settingsDraft.aiAnalyzeLatestOnOpen"
                  type="checkbox"
                />
              </label>
              <label class="switch-row">
                <span>
                  <strong>课堂提醒</strong>
                  <small>关闭后暂停下面所有课堂与 Agent 提醒。</small>
                </span>
                <input v-model="settingsDraft.notifyProblems" type="checkbox" />
              </label>
              <label class="switch-row">
                <span>
                  <strong>渲染公式</strong>
                  <small>显示题目中的 LaTeX 数学公式。</small>
                </span>
                <input v-model="settingsDraft.iftex" type="checkbox" />
              </label>
              <label class="switch-row">
                <span>
                  <strong>显示全部课件页</strong>
                  <small>复习时不只显示最近课件。</small>
                </span>
                <input v-model="settingsDraft.showAllSlides" type="checkbox" />
              </label>
              <label class="switch-row">
                <span>
                  <strong>题目课件页优先</strong>
                  <small>未手工选择图片时，优先使用题目所属课件页。</small>
                </span>
                <input
                  v-model="settingsDraft.aiSlidePickPriority"
                  type="checkbox"
                />
              </label>
            </fieldset>
            <fieldset>
              <legend>提醒事件</legend>
              <div class="reminder-option-grid">
                <label>
                  <input
                    v-model="settingsDraft.notifyProblemStarts"
                    type="checkbox"
                  />
                  <span>新题开始</span>
                </label>
                <label>
                  <input
                    v-model="settingsDraft.notifyAssessmentPublishes"
                    type="checkbox"
                  />
                  <span>考试与题组</span>
                </label>
                <label>
                  <input
                    v-model="settingsDraft.notifyCoursewarePublishes"
                    type="checkbox"
                  />
                  <span>新课件</span>
                </label>
                <label>
                  <input
                    v-model="settingsDraft.notifyOtherPublishes"
                    type="checkbox"
                  />
                  <span>其他发布</span>
                </label>
                <label>
                  <input
                    v-model="settingsDraft.notifyLessonFinished"
                    type="checkbox"
                  />
                  <span>课堂结束</span>
                </label>
                <label>
                  <input
                    v-model="settingsDraft.notifyAutoAnswerScheduled"
                    type="checkbox"
                  />
                  <span>Agent 已排队</span>
                </label>
                <label>
                  <input
                    v-model="settingsDraft.notifyAutoAnswerStarted"
                    type="checkbox"
                  />
                  <span>Agent 已开始</span>
                </label>
                <label>
                  <input
                    v-model="settingsDraft.notifyAutoAnswerSucceeded"
                    type="checkbox"
                  />
                  <span>Agent 已提交</span>
                </label>
                <label>
                  <input
                    v-model="settingsDraft.notifyAutoAnswerFailed"
                    type="checkbox"
                  />
                  <span>Agent 失败</span>
                </label>
              </div>
            </fieldset>
            <fieldset>
              <legend>提醒方式</legend>
              <div class="reminder-option-grid channels">
                <label>
                  <input v-model="settingsDraft.notifyNative" type="checkbox" />
                  <span>系统通知</span>
                </label>
                <label>
                  <input v-model="settingsDraft.notifyPopup" type="checkbox" />
                  <span>页面弹窗</span>
                </label>
                <label>
                  <input v-model="settingsDraft.notifySound" type="checkbox" />
                  <span>提示声音</span>
                </label>
              </div>
              <label class="number-row">
                <span>弹窗持续时间（秒）</span>
                <input
                  v-model.number="settingsDraft.notifyPopupDurationSeconds"
                  type="number"
                  min="2"
                  max="60"
                />
              </label>
              <label class="number-row">
                <span>提醒音量（0–100）</span>
                <input
                  v-model.number="settingsDraft.notifyVolumePercent"
                  type="number"
                  min="0"
                  max="100"
                />
              </label>
              <label class="field-label">
                自定义提示音 URL
                <input
                  v-model="settingsDraft.customNotifyAudioSrc"
                  type="text"
                  placeholder="https://… 或选择本地音频"
                />
              </label>
              <label class="file-field">
                <span>选择本地音频（最大 2MB）</span>
                <input
                  type="file"
                  accept="audio/*"
                  @change="handleNotifyAudioFile"
                />
              </label>
              <p
                v-if="settingsDraft.customNotifyAudioName"
                class="credential-note"
              >
                当前：{{ settingsDraft.customNotifyAudioName }}
              </p>
              <div class="settings-actions">
                <button type="button" @click="testNotification">
                  测试提醒
                </button>
                <button
                  type="button"
                  :disabled="!settingsDraft.customNotifyAudioSrc"
                  @click="clearNotifyAudio"
                >
                  清除自定义提示音
                </button>
              </div>
            </fieldset>
            <fieldset>
              <legend>存储</legend>
              <label class="number-row">
                <span>保留课件数</span>
                <input
                  v-model.number="settingsDraft.maxPresentations"
                  type="number"
                  min="1"
                  max="50"
                />
              </label>
              <label class="number-row">
                <span>资源缓存上限（MB）</span>
                <input
                  v-model.number="settingsDraft.cacheMaxMb"
                  type="number"
                  min="64"
                  max="4096"
                  step="64"
                />
              </label>
              <label class="number-row">
                <span>日志保留天数</span>
                <input
                  v-model.number="settingsDraft.logRetentionDays"
                  type="number"
                  min="1"
                  max="365"
                />
              </label>
            </fieldset>
            <fieldset>
              <legend>使用说明</legend>
              <ol class="help-list">
                <li>在“课堂”页刷新并连接课堂，题目与课件会持续同步。</li>
                <li>
                  手动建议需在“题目”页确认；开启自动确认提交后，Agent
                  会直接提交并写入日志。
                </li>
                <li>课件页支持当前图片下载、整册 PDF、OCR 与翻译。</li>
                <li>
                  在“模型”页连接 AI 服务，并分配 LLM、VLM、OCR 与翻译模型。
                </li>
                <li>“模拟”页可独立验证对象题目、标量题目和课堂提醒。</li>
                <li>“诊断”页集中显示运行状态、数据流、源码模块和操作历史。</li>
              </ol>
              <p class="credential-note">
                桌面版 {{ runtime?.version || '2.0.0' }} ·
                仅供学习辅助，请独立核对答案。
              </p>
            </fieldset>
            <div class="settings-footer">
              <button
                type="submit"
                class="primary-button"
                :disabled="busy === 'settings'"
              >
                {{ busy === 'settings' ? '保存中' : '保存全部设置' }}
              </button>
              <button
                type="button"
                class="danger-button"
                :disabled="busy === 'settings-reset'"
                @click="resetSettings"
              >
                恢复默认设置
              </button>
            </div>
          </form>
          <div v-else class="empty-state">
            <strong>正在读取设置</strong>
          </div>
        </section>

        <section v-else class="panel-page diagnostics-page">
          <div class="section-heading">
            <h2>诊断</h2>
            <button
              type="button"
              :disabled="busy === 'logs'"
              @click="refreshLogs"
            >
              {{ busy === 'logs' ? '读取中' : '刷新日志' }}
            </button>
          </div>

          <dl class="fact-list">
            <div>
              <dt>Backend</dt>
              <dd>
                {{ runtime?.state || 'connecting' }} ·
                {{ runtime?.version || '—' }}
              </dd>
            </div>
            <div>
              <dt>当前页面</dt>
              <dd class="truncate" :title="browserUrl">
                {{ browserUrl || '—' }}
              </dd>
            </div>
            <div>
              <dt>能力</dt>
              <dd>{{ runtime?.capabilities.join(' · ') || '—' }}</dd>
            </div>
          </dl>

          <div class="section-divider">
            <h3>数据流</h3>
          </div>
          <ol class="data-flow">
            <li>
              <strong>真实网页</strong><span>产生 HTTP / WebSocket 流量</span>
            </li>
            <li>
              <strong>Routing</strong><span>观察、脱敏并归一化领域事件</span>
            </li>
            <li>
              <strong>Backend</strong><span>形成课堂、课件和题目上下文</span>
            </li>
            <li>
              <strong>Vue GUI</strong><span>展示来源，收集输入并请求校验</span>
            </li>
            <li>
              <strong>显式确认</strong
              ><span>唯一允许触发答案提交的界面步骤</span>
            </li>
          </ol>

          <div class="section-divider">
            <h3>对应源码模块</h3>
            <span>{{ sourceModules.length }} 个</span>
          </div>
          <div class="module-list">
            <article v-for="module in sourceModules" :key="module.id">
              <div>
                <strong>{{ module.label }}</strong>
                <code>{{ module.path }}</code>
                <p>{{ module.description }}</p>
              </div>
              <button type="button" @click="openSource(module.id)">查看</button>
            </article>
          </div>

          <div class="section-divider">
            <h3>操作历史</h3>
            <span>{{ logs.length }} 条</span>
          </div>
          <div v-if="logs.length" class="log-list">
            <article v-for="entry in logs" :key="entry.id" :class="entry.level">
              <div>
                <strong>{{ entry.scope }} · {{ entry.message }}</strong>
                <small>{{
                  new Date(entry.timestamp).toLocaleString('zh-CN')
                }}</small>
              </div>
              <pre v-if="entry.detailsText">{{ entry.detailsText }}</pre>
            </article>
          </div>
          <div v-else class="empty-state compact">
            <strong>尚未读取操作历史</strong>
            <p>点击“刷新日志”查看最近记录。</p>
          </div>
        </section>
      </div>
    </template>
    <div v-if="noticeToasts.length" class="notice-stack" aria-live="polite">
      <article v-for="notice in noticeToasts" :key="notice.id">
        <div>
          <strong>{{ notice.title }}</strong>
          <span>{{ notice.detail }}</span>
        </div>
        <button
          type="button"
          aria-label="关闭提醒"
          @click="removeNoticeToast(notice.id)"
        >
          关闭
        </button>
      </article>
    </div>
  </aside>
</template>

<style scoped>
.assistant-panel {
  position: fixed;
  z-index: 4;
  top: 96px;
  right: 0;
  bottom: 0;
  width: var(--assistant-width);
  border-left: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--text);
}

.assistant-panel.collapsed {
  display: grid;
  place-items: start center;
  background: var(--surface-subtle);
}

.panel-expand {
  width: 43px;
  height: 132px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
  color: var(--green-strong);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.45;
  writing-mode: vertical-rl;
}

.panel-header {
  display: flex;
  height: 58px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 14px;
  border-bottom: 1px solid var(--line);
}

.panel-header div {
  min-width: 0;
}

.panel-header strong,
.panel-header span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-header strong {
  font-size: 15px;
}

.panel-header span {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 11px;
}

.panel-scroll {
  height: calc(100% - 58px);
  overflow: auto;
  scrollbar-color: #b8c4bd transparent;
  scrollbar-width: thin;
}

.panel-message + .panel-scroll {
  height: calc(100% - 94px);
}

.panel-message {
  display: flex;
  min-height: 36px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 0;
  padding: 9px 14px;
  border-bottom: 1px solid var(--line);
  font-size: 11px;
  line-height: 1.5;
}

.panel-message button {
  min-height: 24px;
  flex: 0 0 auto;
  border-color: currentcolor;
  color: inherit;
  background: transparent;
}

.panel-message.error {
  color: #8d2d2d;
  background: #fff3f1;
}

.panel-message.success {
  color: #16683f;
  background: #edf8f1;
}

.panel-page {
  padding: 16px 14px 28px;
}

.section-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 12px;
}

.section-heading h2 {
  margin: 0;
}

.section-heading h2 {
  font-size: 18px;
  line-height: 1.25;
}

button,
select,
textarea,
input {
  font: inherit;
  font-size: 12px;
  line-height: 1.4;
}

button {
  min-height: 30px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}

button:hover:not(:disabled) {
  border-color: #96b9a5;
  background: var(--green-soft);
}

button:disabled {
  color: #9ba49f;
  background: #f4f6f5;
  cursor: not-allowed;
}

.quiet-button {
  flex: 0 0 auto;
  border-color: transparent;
  background: transparent;
  color: var(--text-muted);
}

.primary-button {
  border-color: var(--green);
  background: var(--green);
  color: #fff;
  font-weight: 700;
}

.primary-button:hover:not(:disabled) {
  border-color: var(--green-strong);
  background: var(--green-strong);
}

.secondary-button {
  border-color: #8ebca2;
  color: var(--green-strong);
  background: #f8fcfa;
  font-weight: 650;
}

.full-width {
  width: 100%;
  margin-top: 12px;
}

.fact-list {
  margin: 0;
  border-top: 1px solid var(--line);
}

.fact-list div {
  display: grid;
  grid-template-columns: 78px 1fr;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--line);
  font-size: 11px;
}

.fact-list dt {
  color: var(--text-muted);
}

.fact-list dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.section-divider {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 20px;
  padding: 10px 0 8px;
  border-top: 1px solid var(--line-strong);
}

.section-divider h3 {
  margin: 0;
  font-size: 13px;
}

.section-divider span,
.count-badge {
  color: var(--text-muted);
  font-size: 10px;
}

.selection-list,
.source-list,
.module-list,
.log-list {
  display: grid;
  gap: 6px;
}

.selection-row {
  display: flex;
  align-items: start;
  gap: 9px;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 10px;
  cursor: pointer;
}

.selection-row.selected {
  border-color: #85b99b;
  background: var(--green-soft);
}

.selection-row span {
  min-width: 0;
}

.selection-row strong,
.selection-row small {
  display: block;
}

.selection-row strong {
  font-size: 12px;
  line-height: 1.4;
}

.selection-row small {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 10px;
}

.empty-state {
  border: 1px dashed #c8d3cd;
  border-radius: 8px;
  padding: 28px 16px;
  color: var(--text-muted);
  text-align: center;
}

.empty-state.compact {
  padding: 18px 12px;
}

.empty-state strong {
  color: var(--text);
  font-size: 12px;
}

.empty-state p,
.inline-empty,
.honest-note {
  margin: 5px 0 0;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.55;
}

.source-list article {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}

.source-kind {
  border-radius: 4px;
  padding: 3px 5px;
  color: var(--green-strong);
  background: var(--green-soft);
  font-size: 9px;
  font-weight: 800;
  text-align: center;
}

.source-list strong,
.source-list small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-list strong {
  font-size: 10px;
}

.source-list small {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 9px;
}

.field-label {
  display: grid;
  gap: 6px;
  margin-top: 12px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 650;
}

select,
textarea,
input[type='number'],
input[type='text'],
input[type='url'],
input[type='password'] {
  width: 100%;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  outline: 0;
  color: var(--text);
  background: #fff;
}

select,
input[type='number'],
input[type='text'],
input[type='url'],
input[type='password'] {
  height: 32px;
  padding: 0 9px;
}

textarea {
  resize: vertical;
  padding: 9px;
  line-height: 1.55;
}

select:focus,
textarea:focus,
input:focus-visible,
button:focus-visible {
  border-color: var(--green);
  box-shadow: 0 0 0 3px rgb(8 138 87 / 14%);
}

.problem-context {
  margin-top: 12px;
  padding: 12px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.context-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--text-muted);
  font-size: 9px;
}

.context-meta span {
  border-radius: 4px;
  background: #eef1ef;
  padding: 3px 5px;
}

.context-meta .status-available,
.context-meta .status-answered {
  color: #12683e;
  background: #e8f6ee;
}

.context-meta .status-expired {
  color: #8a5a10;
  background: #fff3da;
}

.problem-context p {
  margin: 10px 0 0;
  font-size: 12px;
  font-weight: 650;
  line-height: 1.65;
}

.problem-shortcuts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 8px;
}

.compact-context small {
  display: block;
  margin-top: 7px;
  color: var(--text-muted);
  font-size: 12px;
}

.selected-source-row,
.settings-actions,
.settings-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.selected-source-row {
  min-height: 34px;
  color: var(--text-muted);
  font-size: 12px;
}

.ai-slide-preview {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 2px 0 8px;
}

.ai-slide-preview img {
  width: 92px;
  height: 58px;
  flex: 0 0 auto;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface-muted);
  object-fit: contain;
}

.ai-chat {
  margin-top: 14px;
  border-top: 1px solid var(--line-strong);
  padding-top: 12px;
}

.ai-chat-heading,
.ai-chat-heading > div,
.ai-message-label,
.thinking-row {
  display: flex;
  align-items: center;
}

.ai-chat-heading {
  justify-content: space-between;
  gap: 10px;
}

.ai-chat-heading > div {
  min-width: 0;
  gap: 7px;
}

.ai-chat-heading strong {
  font-size: 12px;
}

.ai-chat-heading span,
.ai-message-label span,
.request-recovery,
.ai-composer small {
  color: var(--text-muted);
  font-size: 12px;
}

.ai-message-list {
  display: grid;
  gap: 14px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}

.ai-message {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.ai-message.is-user {
  justify-items: end;
}

.ai-message-label {
  width: 100%;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-muted);
}

.ai-message.is-user .ai-message-label {
  width: min(88%, 300px);
}

.ai-message-label strong {
  color: var(--text);
  font-size: 12px;
  font-weight: 650;
}

.ai-message-body {
  width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.6;
}

.ai-message-body > p {
  margin: 0;
}

.ai-message.is-user .ai-message-body {
  width: min(88%, 300px);
  border: 1px solid #cce3d6;
  border-radius: 7px;
  padding: 9px 10px;
  background: var(--green-soft);
}

.ai-message.is-assistant .ai-message-body {
  border-bottom: 1px solid var(--line);
  padding: 3px 0 12px;
}

.ai-message-body.failed {
  color: #8d2d2d;
}

.thinking-row {
  align-items: flex-start;
  gap: 9px;
}

.thinking-row > span {
  display: flex;
  height: 19px;
  align-items: center;
  gap: 3px;
}

.thinking-row i {
  display: block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--green);
  animation: ai-thinking 1.1s ease-in-out infinite;
}

.thinking-row i:nth-child(2) {
  animation-delay: 120ms;
}

.thinking-row i:nth-child(3) {
  animation-delay: 240ms;
}

.thinking-row p,
.request-recovery {
  margin: 0;
}

.request-recovery {
  margin-top: 5px;
}

.retry-request {
  min-height: 28px;
  margin-top: 8px;
  border-color: transparent;
  padding: 4px 0;
  color: var(--green-strong);
  background: transparent;
  font-size: 12px;
  font-weight: 650;
}

.retry-request:hover:not(:disabled) {
  border-color: transparent;
  background: transparent;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.ai-composer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 7px;
  margin-top: 12px;
  border-top: 1px solid var(--line-strong);
  padding-top: 12px;
}

.ai-composer textarea {
  min-height: 58px;
  resize: none;
}

.ai-composer button {
  align-self: end;
  min-width: 60px;
}

.ai-composer small {
  grid-column: 1 / -1;
}

@keyframes ai-thinking {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.45;
  }

  30% {
    transform: translateY(-3px);
    opacity: 1;
  }
}

.proposal-answer {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  margin: 10px 0 8px;
  padding: 9px 10px;
  border-radius: 6px;
  color: var(--green-strong);
  background: var(--green-soft);
}

.proposal-answer span {
  color: var(--text-muted);
  font-size: 12px;
}

.proposal-answer strong {
  overflow-wrap: anywhere;
  font-size: 12px;
}

.proposal-explanation {
  margin: 8px 0;
  font-size: 12px;
  line-height: 1.6;
}

.ai-markdown {
  min-width: 0;
  overflow-wrap: anywhere;
  color: inherit;
  font-size: 12px;
  line-height: 1.65;
}

.ai-markdown :deep(:first-child) {
  margin-top: 0;
}

.ai-markdown :deep(:last-child) {
  margin-bottom: 0;
}

.ai-markdown :deep(p) {
  margin: 0 0 8px;
}

.ai-markdown :deep(h1),
.ai-markdown :deep(h2),
.ai-markdown :deep(h3),
.ai-markdown :deep(h4),
.ai-markdown :deep(h5),
.ai-markdown :deep(h6) {
  margin: 12px 0 5px;
  color: var(--text);
  line-height: 1.4;
  font-weight: 700;
}

.ai-markdown :deep(h1),
.ai-markdown :deep(h2) {
  font-size: 15px;
}

.ai-markdown :deep(h3),
.ai-markdown :deep(h4),
.ai-markdown :deep(h5),
.ai-markdown :deep(h6) {
  font-size: 12px;
}

.ai-markdown :deep(ul),
.ai-markdown :deep(ol) {
  margin: 6px 0 8px;
  padding-left: 20px;
}

.ai-markdown :deep(li + li) {
  margin-top: 3px;
}

.ai-markdown :deep(blockquote) {
  margin: 8px 0;
  border-left: 1px solid var(--line-strong);
  padding: 5px 9px;
  color: var(--text-muted);
  background: var(--surface-muted);
}

.ai-markdown :deep(hr) {
  margin: 10px 0;
  border: 0;
  border-top: 1px solid var(--line);
}

.ai-markdown :deep(.ai-markdown-code) {
  max-width: 100%;
  overflow: auto;
  margin: 8px 0;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px 9px;
  background: var(--surface-muted);
  white-space: pre;
}

.ai-markdown :deep(.ai-markdown-code code),
.ai-markdown :deep(.ai-markdown-inline-code) {
  font-family: Consolas, monospace;
  font-size: 12px;
}

.ai-markdown :deep(.ai-markdown-inline-code) {
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 4px;
  background: var(--surface-muted);
}

.ai-markdown :deep(a) {
  color: var(--green-strong);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.proposal-failure {
  margin: 9px 0;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  padding: 8px 9px;
  color: #8d2d2d;
  background: #fff3f1;
  font-size: 12px;
}

.proposal-failure p {
  margin: 4px 0 0;
}

.proposal-meta,
.credential-note {
  color: var(--text-muted);
  font-size: 12px;
}

.help-list {
  display: grid;
  gap: 7px;
  margin: 9px 0;
  padding-left: 20px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.proposal-raw pre {
  max-height: 260px;
  overflow: auto;
  margin: 9px 0;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 10px;
  background: var(--surface-subtle);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.proposal-raw {
  margin: 9px 0;
  color: var(--text-muted);
  font-size: 12px;
}

.proposal-raw summary {
  width: fit-content;
  cursor: pointer;
}

.proposal-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.proposal-meta span {
  border-radius: 4px;
  padding: 3px 5px;
  color: var(--green-strong);
  background: var(--green-soft);
}

@media (prefers-reduced-motion: reduce) {
  .thinking-row i {
    animation: none;
    opacity: 0.8;
  }
}

.option-list {
  display: grid;
  gap: 5px;
  margin-top: 10px;
}

.option-list button {
  display: flex;
  min-height: 38px;
  align-items: center;
  gap: 9px;
  padding: 7px 9px;
  text-align: left;
}

.option-list button span {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid #c6d1cb;
  border-radius: 50%;
  font-size: 10px;
  font-weight: 800;
}

.option-list button.selected {
  border-color: #74b58e;
  background: var(--green-soft);
}

.option-list button.selected span {
  border-color: var(--green);
  color: #fff;
  background: var(--green);
}

.validation-result {
  margin-top: 10px;
  border: 1px solid;
  border-radius: 6px;
  padding: 9px 10px;
  font-size: 11px;
}

.validation-result.valid {
  border-color: #a7d2b8;
  color: #155d39;
  background: #edf8f1;
}

.validation-result.invalid {
  border-color: #e4b4ad;
  color: #8b3128;
  background: #fff3f1;
}

.validation-result p {
  margin: 3px 0 0;
  line-height: 1.45;
}

.submit-control {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line-strong);
}

.submit-control label {
  display: flex;
  align-items: start;
  gap: 7px;
  color: #7d581a;
  font-size: 10px;
  line-height: 1.5;
}

.inline-success {
  color: #16683f;
  font-size: 11px;
}

.slide-stage {
  display: grid;
  min-height: 182px;
  place-items: center;
  overflow: hidden;
  margin-top: 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #f1f4f2;
}

.slide-stage img {
  display: block;
  width: 100%;
  max-height: 260px;
  object-fit: contain;
}

.missing-slide {
  color: var(--text-muted);
  font-size: 11px;
}

.slide-controls {
  display: grid;
  grid-template-columns: 70px 1fr 70px;
  gap: 6px;
  margin-top: 8px;
}

.slide-picker-toggle {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 9px;
  text-align: left;
}

.slide-picker-toggle > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slide-picker-summary {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  color: var(--text-muted);
  font-size: 12px;
}

.slide-picker-summary svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentcolor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.5;
  transition: transform 140ms cubic-bezier(0.16, 1, 0.3, 1);
}

.slide-picker-summary svg.open {
  transform: rotate(180deg);
}

.slide-picker-panel {
  margin-top: 7px;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  background: var(--surface);
}

.slide-picker-panel > header {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 9px;
  border-bottom: 1px solid var(--line);
}

.slide-picker-panel > header strong {
  font-size: 12px;
}

.slide-picker-panel > header span {
  color: var(--text-muted);
  font-size: 12px;
}

.slide-thumbnail-list {
  display: grid;
  overflow-y: auto;
  max-height: 320px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  padding: 8px;
  overscroll-behavior: contain;
  scrollbar-color: #b8c4bd transparent;
  scrollbar-width: thin;
}

.slide-thumbnail {
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  grid-template-rows: auto 30px;
  padding: 0;
  border-color: var(--line);
  background: var(--surface);
  text-align: left;
}

.slide-thumbnail:hover:not(:disabled) {
  border-color: var(--line-strong);
  background: var(--surface);
}

.slide-thumbnail.is-current {
  border-color: var(--text-muted);
}

.slide-thumbnail.is-selected {
  border-color: var(--green);
  background: var(--green-soft);
}

.slide-thumbnail:focus-visible {
  position: relative;
  z-index: 1;
}

.slide-thumbnail-media {
  display: grid;
  min-height: 78px;
  place-items: center;
  overflow: hidden;
  color: var(--text-muted);
  background: var(--surface-subtle);
  font-size: 12px;
}

.slide-thumbnail-media img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.slide-thumbnail-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  padding: 0 7px;
}

.slide-thumbnail-meta > strong {
  overflow: hidden;
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slide-thumbnail-states {
  display: flex;
  flex: 0 0 auto;
  gap: 3px;
  font-size: 12px;
}

.current-state,
.selected-state {
  border-radius: 4px;
  padding: 2px 4px;
  line-height: 1.2;
}

.current-state {
  color: var(--text-muted);
  background: var(--surface-subtle);
}

.selected-state {
  color: var(--green-strong);
  background: var(--green-soft);
  font-weight: 700;
}

.quiet-action {
  width: 100%;
  margin-top: 6px;
  border-color: transparent;
  color: var(--green-strong);
  background: transparent;
}

.courseware-actions {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  margin-top: 6px;
}

.media-text {
  width: 100%;
}

.media-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 7px;
}

.inline-field {
  grid-template-columns: 76px 1fr;
  align-items: center;
}

.honest-note {
  margin-top: 8px;
  padding: 8px 9px;
  border: 1px solid #ead6a7;
  border-radius: 6px;
  color: #74531b;
  background: #fff9e9;
}

.settings-form {
  display: grid;
  gap: 14px;
}

.profile-form {
  display: grid;
  gap: 14px;
}

.settings-form fieldset {
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 4px 11px;
}

.settings-form legend {
  padding: 0 5px;
  font-size: 12px;
  font-weight: 750;
}

.profile-connect-panel {
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 4px 11px 11px;
}

.profile-connect-panel legend {
  padding: 0 5px;
  font-size: 12px;
  font-weight: 700;
}

.provider-connect {
  display: grid;
  gap: 8px;
  padding-top: 7px;
}

.provider-connect .field-label {
  margin-top: 0;
}

.provider-connect input[readonly] {
  color: var(--text-muted);
  background: var(--surface-subtle);
}

.profile-pool-heading {
  margin-top: 2px;
}

.profile-card-list {
  display: grid;
  gap: 12px;
}

.profile-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px;
  background: var(--surface);
}

.profile-card.active {
  border-color: var(--green);
  background: #f8fcfa;
}

.profile-card-head,
.profile-card-actions,
.profile-card-meta {
  display: flex;
  align-items: center;
}

.profile-card-head,
.profile-card-meta {
  justify-content: space-between;
  gap: 10px;
}

.profile-card-head div,
.profile-card-head strong,
.profile-card-head span {
  min-width: 0;
}

.profile-card-head strong,
.profile-card-head div > span {
  display: block;
}

.profile-card-head strong {
  overflow: hidden;
  font-size: 15px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-card-head div > span,
.profile-card-meta,
.field-label small {
  color: var(--text-muted);
  font-size: 12px;
}

.profile-card-head div > span {
  margin-top: 2px;
}

.profile-state {
  flex: 0 0 auto;
  border-radius: 4px;
  padding: 3px 5px;
  color: var(--green-strong);
  background: var(--green-soft);
  font-size: 12px;
  font-weight: 700;
}

.profile-card-meta {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

.field-label small {
  font-weight: 500;
}

.profile-capabilities {
  margin-top: 10px;
  border-top: 1px solid var(--line);
}

.capability-heading {
  padding: 10px 0 5px;
}

.capability-heading strong {
  font-size: 12px;
}

.capability-row {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  align-items: center;
  gap: 3px 8px;
  padding: 7px 0;
  border-bottom: 1px solid var(--line);
}

.capability-row > span,
.capability-row > span strong,
.capability-row > span small {
  display: block;
  min-width: 0;
}

.capability-row > span strong,
.capability-row > span small,
.capability-row .model-hint {
  font-size: 12px;
}

.capability-row > span strong {
  color: var(--text);
  font-weight: 700;
}

.capability-row > span small,
.capability-row .model-hint {
  color: var(--text-muted);
  line-height: 1.4;
}

.capability-row select {
  min-width: 0;
}

.capability-row .model-hint {
  grid-column: 2;
}

.temperature-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 104px;
  align-items: center;
  gap: 8px;
  padding: 9px 0 2px;
}

.temperature-row span,
.temperature-row strong,
.temperature-row small {
  display: block;
}

.temperature-row strong,
.temperature-row small,
.temperature-row input {
  font-size: 12px;
}

.temperature-row small {
  margin-top: 2px;
  color: var(--text-muted);
}

.profile-card-actions {
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.profile-empty {
  margin-top: 0;
}

.profile-credential-note {
  margin-top: -4px;
}

.compact-check,
.file-field {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.compact-check input {
  accent-color: var(--green);
}

.paired-number-rows {
  border-bottom: 1px solid var(--line);
}

.credential-note {
  margin: 8px 0 4px;
  line-height: 1.55;
}

.settings-actions {
  justify-content: flex-start;
  margin: 10px 0 6px;
}

.settings-footer {
  justify-content: flex-end;
}

.settings-footer button {
  padding-right: 12px;
  padding-left: 12px;
}

.danger-button {
  border-color: #d8aaa4;
  color: #8d2d2d;
  background: #fff8f7;
}

.switch-row,
.number-row {
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--line);
}

.switch-row:last-child,
.number-row:last-child {
  border-bottom: 0;
}

.switch-row span,
.switch-row strong,
.switch-row small {
  display: block;
}

.switch-row strong,
.number-row {
  font-size: 11px;
}

.switch-row small {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 9px;
}

.switch-row input {
  width: 16px;
  height: 16px;
  accent-color: var(--green);
}

.agent-submit-row {
  border-radius: 6px;
  color: #74531b;
  background: #fff9e9;
}

.number-row input {
  width: 104px;
}

.reminder-option-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px 12px;
  padding: 5px 0 9px;
}

.reminder-option-grid.channels {
  grid-template-columns: 1fr;
  border-bottom: 1px solid var(--line);
}

.reminder-option-grid label {
  display: flex;
  min-height: 34px;
  align-items: center;
  gap: 7px;
  color: var(--text);
  font-size: 12px;
}

.reminder-option-grid input {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}

.notice-stack {
  position: fixed;
  z-index: 8;
  top: 140px;
  right: calc(var(--assistant-width) + 12px);
  width: min(340px, calc(100vw - var(--assistant-width) - 24px));
  display: grid;
  gap: 6px;
  pointer-events: none;
}

.notice-stack article {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  padding: 9px 10px;
  background: #f8fcfa;
  box-shadow: 0 3px 12px rgb(31 52 42 / 7%);
  pointer-events: auto;
}

.notice-stack strong,
.notice-stack span {
  display: block;
  font-size: 12px;
}

.notice-stack span {
  margin-top: 3px;
  color: var(--text-muted);
  line-height: 1.45;
}

.notice-stack button {
  flex: 0 0 auto;
  border: 0;
  padding: 2px 3px;
  color: var(--green-strong);
  background: transparent;
  font-size: 12px;
  cursor: pointer;
}

.data-flow {
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: flow;
}

.data-flow li {
  display: grid;
  grid-template-columns: 22px 90px 1fr;
  gap: 7px;
  align-items: start;
  padding: 7px 0;
  border-bottom: 1px solid var(--line);
  counter-increment: flow;
  font-size: 10px;
}

.data-flow li::before {
  content: counter(flow);
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: var(--green);
  font-size: 9px;
  font-weight: 800;
}

.data-flow span {
  color: var(--text-muted);
  line-height: 1.45;
}

.module-list article,
.log-list article {
  border-bottom: 1px solid var(--line);
  padding: 9px 0;
}

.module-list article {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: start;
}

.module-list strong,
.module-list code,
.module-list p,
.log-list strong,
.log-list small {
  display: block;
}

.module-list strong,
.log-list strong {
  font-size: 10px;
}

.module-list code {
  margin-top: 3px;
  color: #2d6650;
  font-family: Consolas, monospace;
  font-size: 9px;
  overflow-wrap: anywhere;
}

.module-list p {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 9px;
  line-height: 1.45;
}

.log-list article.error {
  color: #8b3128;
}

.log-list small {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 9px;
}

.log-list pre {
  overflow: auto;
  max-height: 120px;
  margin: 6px 0 0;
  color: #53625a;
  font-family: Consolas, monospace;
  font-size: 9px;
  white-space: pre-wrap;
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 920px) {
  .assistant-panel:not(.collapsed) {
    width: min(380px, calc(100vw - 360px));
  }
}

@media (max-width: 680px) {
  .assistant-panel:not(.collapsed) {
    width: 100vw;
  }

  .notice-stack {
    right: 12px;
    width: calc(100vw - 24px);
  }
}

@media (max-width: 420px) {
  .courseware-actions {
    grid-template-columns: 1fr;
  }
}

.panel-header span,
.panel-message,
.fact-list div,
.section-divider span,
.count-badge,
.selection-row small,
.empty-state p,
.inline-empty,
.honest-note,
.source-kind,
.source-list strong,
.source-list small,
.field-label,
.context-meta,
.option-list button span,
.validation-result,
.submit-control label,
.inline-success,
.missing-slide,
.switch-row strong,
.number-row,
.switch-row small,
.data-flow li,
.data-flow li::before,
.module-list strong,
.log-list strong,
.module-list code,
.module-list p,
.log-list small,
.log-list pre {
  font-size: 12px;
}
</style>
