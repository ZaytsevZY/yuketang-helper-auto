// src/ui/mobile-reminder-panel.js
import { REMINDER_CHANNEL_OPTIONS, REMINDER_EVENT_OPTIONS } from '../core/reminder-preferences.js';
import { readReminderForm, syncReminderForm } from '../core/settings-form.js';
import { screenWakeLock } from '../core/screen-wake-lock.js';
import { ui } from './ui-api.js';

let mounted = false;
let root = null;

function optionRow(option) {
  return `
    <label class="ykt-mobile-reminder-row">
      <span class="ykt-mobile-reminder-copy">
        <strong>${option.label}</strong>
        <small>${option.detail}</small>
      </span>
      <input type="checkbox" data-reminder-field="${option.key}" />
    </label>`;
}

function installStyles() {
  if (document.getElementById('ykt-mobile-reminder-styles')) return;
  const style = document.createElement('style');
  style.id = 'ykt-mobile-reminder-styles';
  style.textContent = `
    #ykt-mobile-reminder-root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    #ykt-mobile-reminder-toggle {
      position: fixed; right: 16px; bottom: 22px; z-index: 2147483000;
      width: 52px; height: 52px; border: 0; border-radius: 50%;
      background: #1368d5; color: #fff; box-shadow: 0 8px 22px rgba(0, 61, 153, .36);
      font-size: 23px; line-height: 1; touch-action: manipulation;
    }
    #ykt-mobile-reminder-sheet {
      position: fixed; inset: auto 0 0; z-index: 2147483001;
      max-height: min(82vh, 760px); overflow: auto; box-sizing: border-box;
      padding: 16px 16px calc(18px + env(safe-area-inset-bottom));
      background: #f8fbff; color: #16304e; border-radius: 18px 18px 0 0;
      box-shadow: 0 -12px 30px rgba(5, 42, 89, .22);
      transform: translateY(105%); transition: transform .18s ease-out;
      visibility: hidden;
    }
    #ykt-mobile-reminder-root.ykt-mobile-reminder-open #ykt-mobile-reminder-sheet {
      transform: translateY(0); visibility: visible;
    }
    .ykt-mobile-reminder-header { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
    .ykt-mobile-reminder-header > div { flex: 1; }
    .ykt-mobile-reminder-header p { margin: 3px 0 0; color: #5e7189; font-size: 12px; line-height: 1.45; }
    .ykt-mobile-reminder-eyebrow { color: #1368d5; font-weight: 700; font-size: 11px; letter-spacing: .08em; }
    .ykt-mobile-reminder-header h2 { margin: 1px 0 0; font-size: 20px; color: #102a46; }
    .ykt-mobile-reminder-close { border: 0; background: transparent; font-size: 26px; color: #5d6c7c; padding: 0 4px; }
    .ykt-mobile-reminder-section { margin: 13px 0; border: 1px solid #d7e4f5; border-radius: 12px; overflow: hidden; background: #fff; }
    .ykt-mobile-reminder-section h3 { margin: 0; padding: 10px 12px; color: #254767; background: #eff6ff; font-size: 13px; }
    .ykt-mobile-reminder-row { display: flex; align-items: center; gap: 12px; padding: 11px 12px; border-top: 1px solid #edf2f8; }
    .ykt-mobile-reminder-row:first-of-type { border-top: 0; }
    .ykt-mobile-reminder-copy { flex: 1; min-width: 0; }
    .ykt-mobile-reminder-copy strong { display: block; font-size: 14px; font-weight: 650; }
    .ykt-mobile-reminder-copy small { display: block; margin-top: 3px; color: #687a8e; font-size: 11px; line-height: 1.35; }
    .ykt-mobile-reminder-row input[type="checkbox"] { width: 20px; height: 20px; accent-color: #1368d5; flex: 0 0 auto; }
    .ykt-mobile-reminder-number { display: flex; align-items: center; gap: 10px; padding: 11px 12px; border-top: 1px solid #edf2f8; font-size: 13px; }
    .ykt-mobile-reminder-number label { flex: 1; }
    .ykt-mobile-reminder-number input { width: 72px; border: 1px solid #c6d7ec; border-radius: 8px; padding: 7px; font-size: 14px; }
    .ykt-mobile-reminder-actions { display: flex; gap: 8px; margin-top: 14px; }
    .ykt-mobile-reminder-actions button { flex: 1; min-height: 42px; border-radius: 10px; font-size: 14px; font-weight: 650; }
    #ykt-mobile-reminder-test { border: 1px solid #9abbe5; background: #fff; color: #155eaf; }
    #ykt-mobile-reminder-close-sheet { border: 0; background: #1368d5; color: #fff; }
    #ykt-mobile-reminder-status { min-height: 18px; margin: 8px 2px 0; color: #64778c; font-size: 11px; }
    @media (prefers-reduced-motion: reduce) {
      #ykt-mobile-reminder-sheet { transition: none; }
    }
  `;
  document.head.appendChild(style);
}

export function mountMobileReminderPanel() {
  if (mounted) return root;
  installStyles();

  root = document.createElement('div');
  root.id = 'ykt-mobile-reminder-root';
  root.innerHTML = `
    <button id="ykt-mobile-reminder-toggle" type="button" aria-label="打开课堂提醒控制" aria-expanded="false">🔔</button>
    <section id="ykt-mobile-reminder-sheet" aria-label="课堂提醒控制">
      <header class="ykt-mobile-reminder-header">
        <div>
          <div class="ykt-mobile-reminder-eyebrow">CLASSROOM SIGNAL</div>
          <h2>提醒控制</h2>
          <p>手机版只监听课堂事件，不会启动自动作答或自动进入课堂。</p>
        </div>
        <button class="ykt-mobile-reminder-close" type="button" aria-label="关闭提醒控制">×</button>
      </header>
      <div class="ykt-mobile-reminder-section">
        <label class="ykt-mobile-reminder-row">
          <span class="ykt-mobile-reminder-copy">
            <strong>总提醒开关</strong>
            <small>关闭后，下面的所有课堂事件都不会提醒。</small>
          </span>
          <input type="checkbox" data-reminder-field="notifyProblems" />
        </label>
      </div>
      <div class="ykt-mobile-reminder-section">
        <h3>提醒事件</h3>
        ${REMINDER_EVENT_OPTIONS.map(optionRow).join('')}
      </div>
      <div class="ykt-mobile-reminder-section">
        <h3>提醒方式</h3>
        ${REMINDER_CHANNEL_OPTIONS.map(optionRow).join('')}
        <div class="ykt-mobile-reminder-number">
          <label for="ykt-mobile-reminder-duration">页面弹窗停留（秒）</label>
          <input id="ykt-mobile-reminder-duration" type="number" min="2" max="60" inputmode="numeric" />
        </div>
        <div class="ykt-mobile-reminder-number">
          <label for="ykt-mobile-reminder-volume">提示音量（0–100）</label>
          <input id="ykt-mobile-reminder-volume" type="number" min="0" max="100" inputmode="numeric" />
        </div>
      </div>
      <div class="ykt-mobile-reminder-section">
        <h3>课堂运行</h3>
        <label class="ykt-mobile-reminder-row">
          <span class="ykt-mobile-reminder-copy">
            <strong>课堂保持亮屏</strong>
            <small>仅防自动熄屏；锁屏、后台冻结和系统省电策略无法由脚本绕过。</small>
          </span>
          <input id="ykt-mobile-reminder-wake-lock" type="checkbox" />
        </label>
      </div>
      <div class="ykt-mobile-reminder-actions">
        <button id="ykt-mobile-reminder-test" type="button">测试当前提醒方式</button>
        <button id="ykt-mobile-reminder-close-sheet" type="button">完成</button>
      </div>
      <div id="ykt-mobile-reminder-status" role="status"></div>
    </section>`;
  document.body.appendChild(root);

  const $toggle = root.querySelector('#ykt-mobile-reminder-toggle');
  const $sheet = root.querySelector('#ykt-mobile-reminder-sheet');
  const $close = root.querySelector('.ykt-mobile-reminder-close');
  const $closeSheet = root.querySelector('#ykt-mobile-reminder-close-sheet');
  const $test = root.querySelector('#ykt-mobile-reminder-test');
  const $status = root.querySelector('#ykt-mobile-reminder-status');
  const $duration = root.querySelector('#ykt-mobile-reminder-duration');
  const $volume = root.querySelector('#ykt-mobile-reminder-volume');
  const $wakeLock = root.querySelector('#ykt-mobile-reminder-wake-lock');
  const reminderFields = Object.fromEntries(
    [...root.querySelectorAll('[data-reminder-field]')]
      .map(field => [field.dataset.reminderField, field]),
  );

  const setOpen = (next) => {
    root.classList.toggle('ykt-mobile-reminder-open', next);
    $toggle.setAttribute('aria-expanded', String(next));
    if (next) sync();
  };

  const showWakeLockStatus = status => {
    if (!$wakeLock.checked) {
      $status.textContent = '设置已保存。';
    } else if (status.reason === 'active') {
      $status.textContent = '已请求保持亮屏。';
    } else if (status.reason === 'unsupported') {
      $status.textContent = '当前浏览器不支持保持亮屏。';
    } else if (status.reason === 'request-failed') {
      $status.textContent = '系统未允许保持亮屏，请检查浏览器或省电设置。';
    } else {
      $status.textContent = '设置已保存；页面可见时会尝试保持亮屏。';
    }
  };

  const save = async () => {
    Object.assign(ui.config, readReminderForm(reminderFields));
    ui.config.notifyPopupDuration = Math.max(2000, (+$duration.value || 0) * 1000);
    ui.config.notifyVolume = Math.max(0, Math.min(1, (+$volume.value || 0) / 100));
    ui.config.keepScreenAwake = !!$wakeLock.checked;
    ui.saveConfig();
    const wakeLockStatus = await screenWakeLock.setEnabled(ui.config.keepScreenAwake);
    showWakeLockStatus(wakeLockStatus);
  };

  const sync = () => {
    syncReminderForm(reminderFields, ui.config);
    $duration.value = Math.floor((ui.config.notifyPopupDuration || 5000) / 1000);
    $volume.value = Math.round(100 * (ui.config.notifyVolume ?? 0.6));
    $wakeLock.checked = !!ui.config.keepScreenAwake;
    $status.textContent = '每项修改会自动保存。';
  };

  $toggle.addEventListener('click', () => setOpen(!root.classList.contains('ykt-mobile-reminder-open')));
  $close.addEventListener('click', () => setOpen(false));
  $closeSheet.addEventListener('click', () => setOpen(false));
  $sheet.addEventListener('change', () => { void save(); });
  $test.addEventListener('click', () => {
    ui.notifyProblem({
      problemId: 'MOBILE-REMINDER-TEST',
      body: '【测试提醒】当前已按所选提醒方式发送。',
      options: [],
    }, null, { title: '课堂提醒测试', nativeTitle: '课堂提醒测试' });
  });

  sync();
  mounted = true;
  return root;
}
