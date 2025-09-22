// src/ui/ui-api.js
import { gm } from '../core/env.js';
import { storage } from '../core/storage.js';
import { DEFAULT_CONFIG } from '../core/types.js';
import { repo } from '../state/repo.js';
import { toast } from './toast.js';
import * as SettingsPanel from './panels/settings.js';
import * as AIPanel from './panels/ai.js';
import * as PresPanel from './panels/presentation.js';
import * as ProbListPanel from './panels/problem-list.js';
import * as ActivePanel from './panels/active-problems.js';
import * as TutorialPanel from './panels/tutorial.js';
import { PROBLEM_TYPE_MAP } from '../core/types.js'

const _config = Object.assign({}, DEFAULT_CONFIG, storage.get('config', {}));
_config.ai.apiKey = storage.get('aiApiKey', _config.ai.apiKey);
_config.TYPE_MAP = _config.TYPE_MAP || PROBLEM_TYPE_MAP;

function saveConfig() { storage.set('config', _config); }

export const ui = {
  get config() { return _config; },
  saveConfig,

  updatePresentationList: PresPanel.updatePresentationList,
  updateSlideView: PresPanel.updateSlideView,
  askAIForCurrent: AIPanel.askAIForCurrent,
  updateProblemList: ProbListPanel.updateProblemList,
  updateActiveProblems: ActivePanel.updateActiveProblems,

  showPresentationPanel: PresPanel.showPresentationPanel,
  showProblemListPanel: ProbListPanel.showProblemListPanel,
  showAIPanel: AIPanel.showAIPanel,
  toggleSettingsPanel: SettingsPanel.toggleSettingsPanel,
  toggleTutorialPanel: TutorialPanel.toggleTutorialPanel,

  // 在 index.js 初始化时挂载一次
  _mountAll() {
    SettingsPanel.mountSettingsPanel();
    AIPanel.mountAIPanel();
    PresPanel.mountPresentationPanel();
    ProbListPanel.mountProblemListPanel();
    ActivePanel.mountActiveProblemsPanel();
    TutorialPanel.mountTutorialPanel(); 
    window.addEventListener('ykt:open-ai', () => AIPanel.showAIPanel(true));
  },

  notifyProblem(problem, slide) {
    gm.notify({
      title: '雨课堂习题提示',
      text: this.getProblemDetail(problem),
      image: slide?.thumbnail || null,
      timeout: 5000,
    });
  },

  getProblemDetail(problem) {
    if (!problem) return '题目未找到';
    const lines = [problem.body || ''];
    if (Array.isArray(problem.options)) {
      lines.push(...problem.options.map(({ key, value }) => `${key}. ${value}`));
    }
    return lines.join('\n');
  },

  toast,
  nativeNotify: gm.notify,

  // Buttons 状态
  updateAutoAnswerBtn() {
    const el = document.getElementById('ykt-btn-auto-answer');
    if (!el) return;
    if (_config.autoAnswer) el.classList.add('active'); else el.classList.remove('active');
  },
};
