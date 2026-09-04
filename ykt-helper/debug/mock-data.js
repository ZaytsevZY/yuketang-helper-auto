(function bootstrapStudentClassroom() {
  'use strict';

  const presentation = window.__YKT_TEST_PRESENTATION__;
  const bus = window.__YKT_CLASSROOM__;
  const mock = window.__YKT_MOCK__;
  const $ = (selector) => document.querySelector(selector);
  const selected = new Set();
  let currentSlide = null;
  let platformSocket = null;
  let lastStateSignature = '';

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function log(message) {
    const el = $('#mock-log');
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    el.textContent += `[${time}] ${message}\n`;
    el.scrollTop = el.scrollHeight;
  }
  function slideById(id) { return presentation.slides.find((slide) => slide.id === id) || presentation.slides[0]; }
  function helperPresentation() {
    return {
      id: presentation.id,
      title: presentation.title,
      slides: presentation.slides.map((slide) => ({
        id: slide.id, sid: slide.id, page: slide.page, type: slide.type,
        cover: slide.image, coverAlt: slide.image, image: slide.image, thumbnail: slide.image,
        problem: clone(slide.problem || null),
      })),
    };
  }

  function ensureSocket() {
    if (platformSocket && platformSocket.readyState < 2) return platformSocket;
    platformSocket = new WebSocket('ws://localhost/wsapp/');
    platformSocket.addEventListener('open', () => log('本地 WebSocket 已连接'));
    return platformSocket;
  }

  function loadPresentation() {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `/api/v3/lesson/presentation/fetch?presentation_id=${presentation.id}`);
    xhr.onload = () => log('助手已收到 PPT 数据');
    xhr.send();
  }

  function renderTimeline(slide, status) {
    $('#timeline-list').innerHTML = `<section class="timeline__item active J_slide"><h4>${slide.type === 'problem' ? '课堂习题' : '新幻灯片'}：${slide.title}</h4><p>第 ${slide.page} 页</p><div class="timeline__footer"><span>刚刚</span><span>${status}</span></div></section>`;
  }

  function renderSlide(slide) {
    $('#waiting-card').hidden = true;
    $('#answer-card').hidden = true;
    $('#presentation-card').hidden = false;
    $('#slide-image').src = slide.image;
    $('#slide-caption').textContent = `第 ${slide.page} / ${presentation.slides.length} 页`;
    $('#timer-text').textContent = '课件放映中';
    renderTimeline(slide, '正在放映');
  }

  function renderQuestion(slide) {
    const problem = slide.problem;
    selected.clear();
    $('#waiting-card').hidden = true;
    $('#presentation-card').hidden = true;
    $('#answer-card').hidden = false;
    $('#answer-card').style.setProperty('--slide-background', `url("${slide.image}")`);
    $('#problem-type').textContent = problem.problemType === 2 ? '多选题' : problem.problemType === 4 ? '填空题' : '单选题';
    $('#problem-body').textContent = problem.body;
    $('#question-timer').textContent = '老师可能会随时结束答题';
    $('#mock-submit').classList.remove('ready');
    const container = $('#problem-options');
    container.innerHTML = '';
    if (problem.problemType === 4) {
      const input = document.createElement('input');
      input.className = 'fill-answer'; input.placeholder = '请输入答案'; input.autocomplete = 'off';
      input.addEventListener('input', () => $('#mock-submit').classList.toggle('ready', Boolean(input.value.trim())));
      container.appendChild(input);
    } else {
      for (const option of problem.options) {
        const item = document.createElement('div');
        item.className = 'option'; item.dataset.key = option.key;
        item.innerHTML = `<p class="slide__shape options-label MultipleChoice">${option.key}</p><span>${option.value}</span>`;
        item.addEventListener('click', () => {
          if (problem.problemType !== 2) {
            selected.clear(); container.querySelectorAll('.option').forEach((node) => node.classList.remove('selected'));
          }
          if (selected.has(option.key)) { selected.delete(option.key); item.classList.remove('selected'); }
          else { selected.add(option.key); item.classList.add('selected'); }
          $('#mock-submit').classList.toggle('ready', selected.size > 0);
        });
        container.appendChild(item);
      }
    }
    renderTimeline(slide, '待作答');
  }

  function configureHelper(slide, questionActive) {
    const problem = questionActive ? slide.problem : null;
    mock.setFixtures({
      scenario: questionActive ? `ppt-page-${slide.page}-question` : `ppt-page-${slide.page}`,
      lessonId: presentation.lessonId,
      presentationId: presentation.id,
      slideId: slide.id,
      problem: clone(problem),
      presentation: helperPresentation(),
    });
    mock.setCurrentSlide({ sid: slide.id, type: questionActive ? 'problem' : 'slide', problemID: problem?.problemId || null, index: slide.page - 1 });
    loadPresentation();
    window.setTimeout(() => {
      mock.emit({ op: 'fetchtimeline', timeline: [{ type: questionActive ? 'problem' : 'slide', prob: problem?.problemId || null, sid: slide.id, pres: presentation.id, dt: Date.now(), limit: 120 }] });
      if (questionActive) mock.emit({ op: 'unlockproblem', problem: { prob: problem.problemId, sid: slide.id, pres: presentation.id, dt: Date.now(), limit: 120 } });
    }, 60);
  }

  function applyClassroomState(state) {
    if (!state?.slideId) return;
    const signature = `${state.status}:${state.slideId}:${state.updatedAt}`;
    if (signature === lastStateSignature) return;
    lastStateSignature = signature;
    currentSlide = slideById(state.slideId);
    const questionActive = state.status === 'question' && Boolean(currentSlide.problem);
    configureHelper(currentSlide, questionActive);
    if (questionActive) renderQuestion(currentSlide); else renderSlide(currentSlide);
    if (state.status === 'question-finished') {
      $('#timer-text').textContent = '答题已结束';
      mock.emit({ op: 'lessonfinished' });
    }
    $('#mock-status').textContent = '● synced';
    $('#mock-status').style.color = '#7fe2a2';
    log(questionActive ? `收到题目：${currentSlide.title}` : `收到 PPT 第 ${currentSlide.page} 页`);
  }

  function resetStudent() {
    currentSlide = null; lastStateSignature = '';
    $('#waiting-card').hidden = false; $('#presentation-card').hidden = true; $('#answer-card').hidden = true;
    $('#timeline-list').innerHTML = '';
    log('课堂已重置');
  }

  bus.subscribe((message) => {
    if (message.type === 'classroom-state') applyClassroomState(message.payload);
    if (message.type === 'classroom-reset') resetStudent();
  });
  window.addEventListener('ykt-mock:answer', (event) => {
    const body = clone(event.detail || {});
    const first = body.problems?.[0];
    bus.send('student-answer', first || body);
    renderTimeline(currentSlide || presentation.slides[0], '已提交');
    log('答案已在本地提交给老师端');
  });
  window.addEventListener('ykt-mock:log', (event) => {
    if (event.detail?.kind === 'gm:xhr-proxy') log('AI 请求已通过本机代理发送');
  });

  $('#mock-submit').addEventListener('click', () => {
    if (!currentSlide?.problem) return;
    const fill = $('#problem-options .fill-answer');
    const result = fill ? [fill.value.trim()] : [...selected];
    if (!result.length || result.some((value) => !value)) { log('请先填写答案'); return; }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v3/lesson/problem/answer');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = () => { $('#question-timer').textContent = '答案已提交'; $('#mock-submit').textContent = '已提交'; };
    xhr.send(JSON.stringify({ problemId: currentSlide.problem.problemId, problemType: currentSlide.problem.problemType, dt: Date.now(), result }));
  });
  $('#request-state').addEventListener('click', () => {
    const state = bus.loadState();
    if (state) applyClassroomState(state); else log('老师端尚未播放课件');
    bus.send('student-hello', { lessonId: presentation.lessonId });
  });
  $('#toggle-network').addEventListener('click', () => {
    const online = mock.setOnline(!mock.isOnline());
    $('#mock-status').textContent = online ? '● synced' : '● offline';
    $('#mock-status').style.color = online ? '#7fe2a2' : '#ff9090';
    $('#toggle-network').textContent = online ? '模拟断网' : '恢复网络';
  });

  ensureSocket();
  const initial = bus.loadState();
  if (initial) applyClassroomState(initial);
  bus.send('student-hello', { lessonId: presentation.lessonId });
  window.setInterval(() => bus.send('student-heartbeat', { lessonId: presentation.lessonId }), 5000);
  log('学生端就绪，等待老师操作');
})();
