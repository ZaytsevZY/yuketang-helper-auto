(function bootstrapTeacherConsole() {
  'use strict';

  const presentation = window.__YKT_TEST_PRESENTATION__;
  const bus = window.__YKT_CLASSROOM__;
  const slides = presentation.slides;
  let selectedIndex = 0;
  let activeQuestionId = null;
  let studentSeenAt = 0;

  const $ = (selector) => document.querySelector(selector);
  const slideList = $('#teacher-slide-list');
  const logEl = $('#teacher-log');

  function log(message) {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    logEl.textContent += `[${time}] ${message}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function renderSlideList() {
    slideList.innerHTML = '';
    slides.forEach((slide, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `slide-thumb${index === selectedIndex ? ' active' : ''}`;
      button.innerHTML = `<img src="${slide.image}" alt="第 ${slide.page} 页"><span>${slide.page}. ${slide.title}</span>`;
      button.addEventListener('click', () => selectSlide(index));
      slideList.appendChild(button);
    });
  }

  function selectSlide(index) {
    selectedIndex = Math.max(0, Math.min(slides.length - 1, index));
    const slide = slides[selectedIndex];
    $('#teacher-slide-image').src = slide.image;
    $('#teacher-page-label').textContent = `第 ${slide.page} / ${slides.length} 页`;
    $('#publish-question').disabled = !slide.problem;
    $('#finish-question').disabled = activeQuestionId == null;
    $('#question-preview').innerHTML = slide.problem
      ? `<strong>${slide.problem.problemType === 2 ? '多选题' : slide.problem.problemType === 4 ? '填空题' : '单选题'}</strong>${slide.problem.body}<br><small>标准答案：${slide.problem.answer.join('、')}</small>`
      : '<strong>普通课件页</strong>此页没有题目，可直接播放给学生。';
    renderSlideList();
  }

  function classroomState(status) {
    return {
      version: 1,
      status,
      presentationId: presentation.id,
      slideId: slides[selectedIndex].id,
      activeQuestionId,
      updatedAt: Date.now(),
    };
  }

  function publish(status, message) {
    bus.saveState(classroomState(status));
    log(message);
  }

  function markStudentOnline() {
    studentSeenAt = Date.now();
    $('#student-dot').classList.add('online');
    $('#student-status').textContent = '学生端已连接';
  }

  function renderAnswer(payload) {
    const answer = payload?.result ?? payload?.answer ?? [];
    const problemId = payload?.problemId ?? payload?.problems?.[0]?.problemId ?? 'unknown';
    const normalized = Array.isArray(answer) ? answer.join('、') : String(answer);
    const feed = $('#answer-feed');
    if (feed.querySelector('.empty-state')) feed.innerHTML = '';
    const item = document.createElement('div');
    item.className = 'answer-item';
    item.innerHTML = `<strong>本地学生 · 题目 ${problemId}</strong><span>${normalized || '（空答案）'}</span>`;
    feed.prepend(item);
    log(`收到答案：${normalized || '空'}`);
  }

  bus.subscribe((message) => {
    if (message.type === 'student-hello' || message.type === 'student-heartbeat') {
      markStudentOnline();
      if (message.type === 'student-hello') {
        const state = bus.loadState();
        if (state) bus.send('classroom-state', state);
      }
    }
    if (message.type === 'student-answer') renderAnswer(message.payload);
  });

  $('#previous-slide').addEventListener('click', () => selectSlide(selectedIndex - 1));
  $('#next-slide').addEventListener('click', () => selectSlide(selectedIndex + 1));
  $('#play-slide').addEventListener('click', () => {
    activeQuestionId = null;
    publish('slide', `已播放第 ${slides[selectedIndex].page} 页`);
    selectSlide(selectedIndex);
  });
  $('#publish-question').addEventListener('click', () => {
    const slide = slides[selectedIndex];
    if (!slide.problem) return;
    activeQuestionId = slide.problem.problemId;
    publish('question', `已发题：${slide.problem.body}`);
    selectSlide(selectedIndex);
  });
  $('#finish-question').addEventListener('click', () => {
    publish('question-finished', '已结束当前答题');
    activeQuestionId = null;
    selectSlide(selectedIndex);
  });
  $('#reset-classroom').addEventListener('click', () => {
    activeQuestionId = null;
    bus.reset();
    $('#answer-feed').innerHTML = '<p class="empty-state">尚未收到答案</p>';
    selectSlide(0);
    log('课堂已重置');
  });

  window.setInterval(() => {
    if (studentSeenAt && Date.now() - studentSeenAt > 12000) {
      $('#student-dot').classList.remove('online');
      $('#student-status').textContent = '学生端已离线';
    }
  }, 3000);

  selectSlide(0);
  log('老师端就绪，请打开学生页面');
})();
