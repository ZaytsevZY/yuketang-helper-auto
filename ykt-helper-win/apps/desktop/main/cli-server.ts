import { lstat, rm } from 'node:fs/promises';
import { connect, createServer, type Server, type Socket } from 'node:net';

import {
  CliRpcMethod,
  DesktopCliPipePath,
  ErrorCode,
  YuketangError,
  type CliRpcRequest,
  type CliRpcResponse,
  type JsonValue,
} from '@ykt/contracts';

export type DesktopCliHandler = (
  method: CliRpcMethod,
  params: JsonValue | undefined,
) => Promise<unknown>;

export class DesktopCliServer {
  readonly #server: Server;
  #started = false;
  #closePromise: Promise<void> | null = null;

  constructor(
    private readonly handler: DesktopCliHandler,
    private readonly pipePath = DesktopCliPipePath,
  ) {
    this.#server = createServer((socket) => this.handle(socket));
  }

  async start(): Promise<void> {
    try {
      await this.listen();
    } catch (error: unknown) {
      if (
        process.platform === 'win32' ||
        !isNodeError(error, 'EADDRINUSE') ||
        (await isActiveSocket(this.pipePath)) ||
        !(await isSocketFile(this.pipePath))
      ) {
        throw error;
      }
      await rm(this.pipePath, { force: true });
      await this.listen();
    }
    this.#started = true;
  }

  async close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    if (!this.#started) return;
    this.#started = false;
    this.#closePromise = new Promise<void>((resolve) =>
      this.#server.close(() => resolve()),
    ).finally(() => {
      this.#closePromise = null;
    });
    return this.#closePromise;
  }

  private async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#server.once('error', reject);
      this.#server.listen(this.pipePath, () => {
        this.#server.off('error', reject);
        resolve();
      });
    });
  }

  private handle(socket: Socket): void {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      socket.removeAllListeners('data');
      void this.respond(socket, line);
    });
  }

  private async respond(socket: Socket, line: string): Promise<void> {
    let id = '';
    try {
      const request = parseRequest(line);
      id = request.id;
      const result = toJsonValue(
        await this.handler(request.method, request.params),
      );
      writeResponse(socket, { version: 1, id, ok: true, result });
    } catch (error: unknown) {
      const details =
        error instanceof YuketangError && error.details
          ? toJsonValue(error.details)
          : undefined;
      writeResponse(socket, {
        version: 1,
        id,
        ok: false,
        error: {
          code:
            error instanceof YuketangError
              ? error.code
              : ErrorCode.InternalError,
          message:
            error instanceof Error ? error.message : 'CLI request failed.',
          ...(details === undefined ? {} : { details }),
        },
      });
    }
  }
}

async function isSocketFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSocket();
  } catch (error: unknown) {
    if (isNodeError(error, 'ENOENT')) return false;
    throw error;
  }
}

async function isActiveSocket(path: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const socket = connect(path);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', (error: unknown) => {
      socket.destroy();
      if (isNodeError(error, 'ECONNREFUSED') || isNodeError(error, 'ENOENT')) {
        resolve(false);
        return;
      }
      reject(error);
    });
  });
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error && (error as NodeJS.ErrnoException).code === code
  );
}

function parseRequest(line: string): CliRpcRequest {
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid CLI request.');
  }
  const request = value as Record<string, unknown>;
  if (
    request.version !== 1 ||
    typeof request.id !== 'string' ||
    !Object.values(CliRpcMethod).includes(request.method as CliRpcMethod)
  ) {
    throw new Error('Invalid CLI request.');
  }
  return value as CliRpcRequest;
}

function writeResponse(socket: Socket, response: CliRpcResponse): void {
  socket.end(`${JSON.stringify(response)}\n`);
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
