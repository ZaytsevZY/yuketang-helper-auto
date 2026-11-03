import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserEnvironment, ProblemType } from '@ykt/contracts';
import { MemoryAppDataStore } from '@ykt/storage';
import { YuketangActiveClient } from '@ykt/routing';
import { createBackendRuntime, type BackendRuntime } from './runtime.js';

const runtimes: BackendRuntime[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
});
async function setup() {
  const dataStore = new MemoryAppDataStore();
  const client = new YuketangActiveClient({
    credentials: {
      load: async () => ({ cookieHeader: '', bearerToken: null, userId: null }),
    },
  });
  vi.spyOn(client, 'listLessons').mockResolvedValue([
    {
      id: 'lesson',
      title: 'Test',
      status: 'active',
      classroomId: null,
      presentationId: null,
    },
  ]);
  vi.spyOn(client, 'checkin').mockResolvedValue({
    lessonToken: 'test',
    expiresAt: null,
  });
  vi.spyOn(client, 'connectLesson').mockImplementation(() => {});
  const post = vi.spyOn(client, 'submit').mockResolvedValue({ code: 0 });
  const runtime = createBackendRuntime({ dataStore, activeClient: client });
  runtimes.push(runtime);
  await runtime.start();
  await runtime.facade.updateSettings({
    llmAutoGenerate: true,
    llmManagedSubmit: true,
  });
  await runtime.facade.refreshLessons(BrowserEnvironment.Standard);
  await runtime.facade.connectLesson(BrowserEnvironment.Standard, 'lesson');
  const session = runtime.lessons.getSession('lesson')!;
  for (const id of ['first', 'second']) {
    session.upsertProblem({
      id,
      lessonId: 'lesson',
      presentationId: 'deck',
      slideId: id,
      type: ProblemType.SingleChoice,
      prompt: 'Test',
      options: ['A', 'B'],
      blanks: [],
      result: null,
    });
    session.unlockProblem(id, 'deck', id, Date.now(), null, Date.now());
    await dataStore.putDocument({
      key: `ai:proposal:proposal-${id}`,
      kind: 'answer-proposal',
      value: {
        id: `proposal-${id}`,
        problemId: id,
        status: 'ready',
        answer: ['A'],
      },
      updatedAt: new Date().toISOString(),
      expiresAt: null,
    });
  }
  const submit = (id: string) =>
    runtime.facade.submitAnswer({
      problemId: id,
      answer: ['A'],
      proposalId: `proposal-${id}`,
      confirmedBy: 'agent',
    });
  return { runtime, dataStore, post, submit };
}

describe('managed submission acknowledgments', () => {
  it('updates the first answer and leaves the second question independently submittable', async () => {
    const { runtime, post, submit } = await setup();
    await submit('first');
    expect(await runtime.facade.listProblems('lesson')).toEqual([
      expect.objectContaining({
        id: 'first',
        status: 'answered',
        result: ['A'],
      }),
      expect.objectContaining({
        id: 'second',
        status: 'available',
        result: null,
      }),
    ]);
    await submit('second');
    expect(
      (await runtime.facade.listProblems('lesson')).every(
        (problem) => problem.status === 'answered',
      ),
    ).toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('returns a committed submission even if writing the AI audit outcome fails', async () => {
    const { runtime, dataStore, submit, post } = await setup();
    vi.spyOn(dataStore, 'putDocument').mockRejectedValueOnce(
      new Error('audit unavailable'),
    );
    expect(await submit('first')).toMatchObject({ status: 'submitted' });
    expect((await runtime.facade.getProblem('first')).status).toBe('answered');
    expect(await runtime.facade.listLogs()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warn',
          scope: 'answer',
          message: '答案已提交，但 AI 提交审计记录保存失败。',
        }),
      ]),
    );
    expect(await submit('second')).toMatchObject({ status: 'submitted' });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('does not turn a log failure into a rejected answer or mask a genuine submission failure', async () => {
    const { runtime, dataStore, submit, post } = await setup();
    const append = dataStore.appendLog.bind(dataStore);
    vi.spyOn(dataStore, 'appendLog').mockImplementation(async (entry) => {
      if (entry.scope === 'answer') throw new Error('log unavailable');
      return append(entry);
    });
    expect(await submit('first')).toMatchObject({ status: 'submitted' });
    post.mockRejectedValueOnce(new Error('server rejected second answer'));
    await expect(submit('second')).rejects.toThrow(
      'server rejected second answer',
    );
    expect((await runtime.facade.getProblem('second')).status).toBe(
      'available',
    );
  });
});
