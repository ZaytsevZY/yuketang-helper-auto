import { createServer, type Server, type Socket } from 'node:net';

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

  constructor(
    private readonly handler: DesktopCliHandler,
    private readonly pipePath = DesktopCliPipePath,
  ) {
    this.#server = createServer((socket) => this.handle(socket));
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#server.once('error', reject);
      this.#server.listen(this.pipePath, () => {
        this.#server.off('error', reject);
        this.#started = true;
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
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
