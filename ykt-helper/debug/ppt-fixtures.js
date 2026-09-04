(function defineTestPresentation() {
  'use strict';

  const sourceImage = (page) => `/debug/fixtures/test-ppt/slide-${page}.png`;
  const option = (key, value) => ({ key, value });
  const escapeXml = (value) => String(value || '').replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]));
  function readableSlide(page, title, options = [], selected = [], fill = false) {
    const optionMarkup = options.map((item, index) => {
      const y = 290 + index * 82;
      const active = selected.includes(item.key);
      const shape = fill
        ? `<rect x="185" y="${y - 36}" width="540" height="58" rx="8" fill="#fff" stroke="#6ea0ff" stroke-width="3"/><text x="205" y="${y + 2}" font-size="27" fill="#789">[ 填空 1 ]</text>`
        : `<circle cx="220" cy="${y - 8}" r="27" fill="${active ? '#20c933' : '#929292'}" stroke="#222" stroke-width="2"/><text x="220" y="${y + 1}" text-anchor="middle" font-size="25" fill="#fff">${escapeXml(item.key)}</text><text x="280" y="${y + 2}" font-size="30" fill="#222">${escapeXml(item.value)}</text>`;
      return shape;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#fff"/><rect width="1280" height="58" fill="#f2f3f5"/><rect width="18" height="58" fill="#65a1f5"/><text x="150" y="40" font-family="Arial Unicode MS, PingFang SC, sans-serif" font-size="24" fill="#666">${page}</text><text x="180" y="180" font-family="Arial Unicode MS, PingFang SC, sans-serif" font-size="36" font-weight="600" fill="#202124">${escapeXml(title)}</text><g font-family="Arial Unicode MS, PingFang SC, sans-serif">${optionMarkup}</g><rect x="940" y="650" width="150" height="42" rx="7" fill="#8d8d8d"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  window.__YKT_TEST_PRESENTATION__ = Object.freeze({
    id: 'mock-presentation-test-ppt',
    lessonId: 'mock-lesson',
    title: '测试ppt',
    source: '测试ppt.pptx',
    slides: [
      { id: 'mock-slide-1', page: 1, type: 'slide', title: '测试ppt', image: readableSlide(1, '测试ppt'), sourceImage: sourceImage(1) },
      {
        id: 'mock-slide-2', page: 2, type: 'problem', title: '这是一道测试题，选A', image: readableSlide(2, '这是一道测试题，选A', ['A', 'B', 'C', 'D'].map((key) => option(key, key)), ['A']), sourceImage: sourceImage(2),
        problem: { problemId: 90002, problemType: 1, body: '这是一道测试题，选A', options: ['A', 'B', 'C', 'D'].map((key) => option(key, key)), answer: ['A'] },
      },
      {
        id: 'mock-slide-3', page: 3, type: 'problem', title: '1+1等于多少', image: readableSlide(3, '1+1等于多少', [option('A', '3'), option('B', '2'), option('C', '5'), option('D', '10')], ['B']), sourceImage: sourceImage(3),
        problem: { problemId: 90003, problemType: 1, body: '1+1等于多少', options: [option('A', '3'), option('B', '2'), option('C', '5'), option('D', '10')], answer: ['B'] },
      },
      {
        id: 'mock-slide-4', page: 4, type: 'problem', title: '测试题，选A和C', image: readableSlide(4, '测试题，选A和C', [option('A', '1'), option('B', '2'), option('C', '3'), option('D', '4')], ['A', 'C']), sourceImage: sourceImage(4),
        problem: { problemId: 90004, problemType: 2, body: '测试题，选A和C', options: [option('A', '1'), option('B', '2'), option('C', '3'), option('D', '4')], answer: ['A', 'C'] },
      },
      {
        id: 'mock-slide-5', page: 5, type: 'problem', title: '填空题：苹果', image: readableSlide(5, '填空题，回答为“苹果”', [option('1', '')], [], true), sourceImage: sourceImage(5),
        problem: { problemId: 90005, problemType: 4, body: '填空题，回答为“苹果”', options: [], blanks: [{ index: 0 }], answer: ['苹果'] },
      },
      {
        id: 'mock-slide-6', page: 6, type: 'problem', title: '一加一等于多少？', image: readableSlide(6, '一加一等于多少？', [option('1', '')], [], true), sourceImage: sourceImage(6),
        problem: { problemId: 90006, problemType: 4, body: '一加一等于多少？', options: [], blanks: [{ index: 0 }], answer: ['2'] },
      },
    ],
  });
})();
