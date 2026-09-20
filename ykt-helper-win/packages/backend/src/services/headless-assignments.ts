import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AssignmentDetail, AssignmentSnapshot } from '@ykt/contracts';
import {
  AssignmentAuthError,
  NodeAssignmentSession,
  YuketangActiveClient,
} from '@ykt/routing';

export interface AssignmentSessionInput {
  environment: 'pro';
  cookieHeader: string;
  bearerToken?: string | null;
  userId?: string | null;
}

interface Cache {
  version: 1;
  snapshot?: AssignmentSnapshot;
  details: Record<string, AssignmentDetail>;
}

export class AssignmentReadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function parseAssignmentSession(value: unknown): AssignmentSessionInput {
  if (!value || typeof value !== 'object')
    throw new AssignmentReadError(
      'INVALID_ARGUMENT',
      '会话文件必须是 JSON 对象。',
    );
  const input = value as Record<string, unknown>;
  if (
    input.environment !== 'pro' ||
    typeof input.cookieHeader !== 'string' ||
    !/(?:^|;\s*)sessionid=[^;\s]+/.test(input.cookieHeader) ||
    /[\r\n]/.test(input.cookieHeader) ||
    (input.bearerToken != null && typeof input.bearerToken !== 'string') ||
    (input.userId != null && typeof input.userId !== 'string')
  )
    throw new AssignmentReadError(
      'INVALID_ARGUMENT',
      '需要 pro 会话及有效的 cookieHeader；凭据请通过会话文件或 stdin 提供。',
    );
  return {
    environment: 'pro',
    cookieHeader: input.cookieHeader,
    bearerToken: (input.bearerToken as string | null | undefined) ?? null,
    userId: (input.userId as string | null | undefined) ?? null,
  };
}

/** Read-only standalone counterpart of the Desktop assignment facade. */
export class HeadlessAssignments {
  private readonly client: Pick<
    YuketangActiveClient,
    'listAssignments' | 'getAssignmentDetail'
  >;
  private readonly cachePath: string;
  private cache: Cache = { version: 1, details: {} };
  private loaded = false;
  constructor(
    session: AssignmentSessionInput,
    private readonly cacheDir: string,
    private readonly now = Date.now,
    client?: Pick<
      YuketangActiveClient,
      'listAssignments' | 'getAssignmentDetail'
    >,
  ) {
    const transport = new NodeAssignmentSession({
      cookieHeader: session.cookieHeader,
      bearerToken: session.bearerToken ?? null,
      userId: session.userId ?? null,
    });
    this.client =
      client ??
      new YuketangActiveClient({ credentials: transport, transport, now });
    const scope = createHash('sha256')
      .update(
        JSON.stringify([
          session.environment,
          session.cookieHeader,
          session.bearerToken ?? null,
          session.userId ?? null,
        ]),
      )
      .digest('hex');
    this.cachePath = join(cacheDir, `assignments-${scope}.json`);
  }

  private fresh(time: number) {
    return (
      Number.isFinite(time) &&
      time <= this.now() &&
      this.now() - time < 30 * 60_000
    );
  }
  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(
        await readFile(this.cachePath, 'utf8'),
      ) as Cache;
      if (
        parsed.version === 1 &&
        parsed.details &&
        typeof parsed.details === 'object' &&
        !Array.isArray(parsed.details) &&
        (!parsed.snapshot ||
          (parsed.snapshot.environment === 'pro' &&
            Array.isArray(parsed.snapshot.assignments))) &&
        Object.entries(parsed.details).every(
          ([id, detail]) =>
            detail &&
            detail.assignment?.id === id &&
            Array.isArray(detail.problems) &&
            Number.isFinite(detail.fetchedAt),
        )
      )
        this.cache = parsed;
    } catch {
      /* Missing or damaged local cache is a cache miss. */
    }
  }
  private async save() {
    await mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
    // Same-directory atomic replacement prevents interrupted commands corrupting it.
    const temporary = `${this.cachePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(this.cache), { mode: 0o600 });
    await rename(temporary, this.cachePath);
  }
  private async request<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof AssignmentAuthError)) throw error;
      this.cache = { version: 1, details: {} };
      await rm(this.cachePath, { force: true });
      throw new AssignmentReadError(
        'SESSION_EXPIRED',
        '荷塘雨课堂会话已失效，请更新 --session-file 中的登录凭据后重试。',
      );
    }
  }
  async list(refresh = false): Promise<AssignmentSnapshot> {
    await this.load();
    if (
      !refresh &&
      this.cache.snapshot &&
      this.fresh(this.cache.snapshot.fetchedAt)
    )
      return this.cache.snapshot;
    const snapshot = await this.request(() =>
      this.client.listAssignments('pro'),
    );
    this.cache = { version: 1, snapshot, details: {} };
    await this.save();
    return snapshot;
  }
  async detail(id: string, refresh = false): Promise<AssignmentDetail> {
    const snapshot = await this.list();
    const assignment = snapshot.assignments.find((item) => item.id === id);
    if (!assignment)
      throw new AssignmentReadError(
        'NOT_FOUND',
        '未找到该作业/考试，请刷新列表后使用返回的 id。',
      );
    const cached = this.cache.details[id];
    if (!refresh && cached && this.fresh(cached.fetchedAt)) return cached;
    const detail = await this.request(() =>
      this.client.getAssignmentDetail('pro', assignment),
    );
    this.cache.details[id] = detail;
    this.cache.details = Object.fromEntries(
      Object.entries(this.cache.details)
        .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
        .slice(0, 80),
    );
    await this.save();
    return detail;
  }
}
