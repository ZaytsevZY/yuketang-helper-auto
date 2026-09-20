import { dataOf, AssignmentAuthError } from './assignments.js';
import type { ActiveHttpTransport } from './types.js';

/** Official /trans handoff, restricted to result viewing. Never start/reset an exam. */
export async function openExamReviewSession(
  transport: ActiveHttpTransport,
  tokenResponse: unknown,
  examId: string,
): Promise<(path: string) => Promise<unknown>> {
  const data = dataOf(tokenResponse);
  const host = new URL(
    typeof data.exam_host === 'string'
      ? data.exam_host
      : 'https://examination.xuetangx.com',
  );
  if (
    host.protocol !== 'https:' ||
    host.username ||
    host.password ||
    host.port ||
    !['tsinghua-exam.yuketang.cn', 'examination.xuetangx.com'].includes(
      host.hostname,
    )
  )
    throw new Error('考试结果服务地址暂不支持，请在官网查看。');
  if (
    typeof data.token !== 'string' ||
    !data.token ||
    !['number', 'string'].includes(typeof data.user_id) ||
    !String(data.user_id)
  )
    throw new AssignmentAuthError();
  const resultUrl = `${host.origin}/result/${encodeURIComponent(examId)}?isFrom=2`;
  const query = new URLSearchParams({
    exam_id: examId,
    user_id: String(data.user_id),
    crypt: data.token,
    next: resultUrl,
    language: 'zh',
  });
  // Chromium Session stores the exam-domain cookies. Platform bearer/cookie
  // headers are never copied to this host, nor are tokens returned to Renderer.
  try {
    const login = await transport.request({
      method: 'GET',
      url: `${host.origin}/login?${query}`,
      headers: {},
      body: null,
      redirect: 'manual',
    });
    if (![200, 302, 303].includes(login.status))
      throw new AssignmentAuthError();
  } catch (error) {
    // Electron net.fetch rejects a deliberately stopped manual redirect instead
    // of returning 302 (electron/electron#43715). This is NOT login success:
    // the next cover must authenticate and match the token's user before reading.
    if (!(error instanceof Error) || error.message !== 'Redirect was cancelled')
      throw error;
  }
  let verifiedUser = false;
  return async (path) => {
    if (
      ![
        '/exam_room/cover',
        '/exam_room/problem_results',
        '/exam_room/show_paper',
      ].includes(path)
    )
      throw new Error('不支持的考试结果接口。');
    if (path !== '/exam_room/cover' && !verifiedUser)
      throw new AssignmentAuthError();
    const response = await transport.request({
      method: 'GET',
      url: `${host.origin}${path}?${new URLSearchParams({ exam_id: examId })}`,
      headers: { 'x-client': 'web', xtbz: 'cloud', referer: resultUrl },
      body: null,
      redirect: 'manual',
    });
    if (
      response.status === 401 ||
      response.status === 403 ||
      (response.status >= 300 && response.status < 400)
    )
      throw new AssignmentAuthError();
    if (response.status !== 200)
      throw new Error(`考试结果读取失败（HTTP ${response.status}）。`);
    if (path === '/exam_room/cover') {
      const user = dataOf(response.body).user;
      if (
        !user ||
        typeof user !== 'object' ||
        !('user_id' in user) ||
        String(user.user_id) !== String(data.user_id)
      )
        throw new AssignmentAuthError();
      verifiedUser = true;
    }
    return response.body;
  };
}
