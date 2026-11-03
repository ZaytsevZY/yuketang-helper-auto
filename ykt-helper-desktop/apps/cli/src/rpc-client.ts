import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';

import {
  DesktopCliPipePath,
  type CliRpcMethod,
  type CliRpcRequest,
  type CliRpcResponse,
  type JsonValue,
} from '@ykt/contracts';

export class DesktopCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: JsonValue,
  ) {
    super(message);
    this.name = 'DesktopCliError';
  }
}

export async function requestDesktop(
  method: CliRpcMethod,
  params?: JsonValue,
  pipePath = DesktopCliPipePath,
): Promise<JsonValue> {
  const request: CliRpcRequest = {
    version: 1,
    id: randomUUID(),
    method,
    ...(params === undefined ? {} : { params }),
  };

  return new Promise<JsonValue>((resolve, reject) => {
    const socket = createConnection(pipePath);
    let buffer = '';
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    socket.setEncoding('utf8');
    socket.once('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline)) as CliRpcResponse;
        if (response.id !== request.id || response.version !== 1) {
          fail(new Error('Desktop returned an invalid response.'));
          return;
        }
        settled = true;
        socket.end();
        if (response.ok) resolve(response.result);
        else {
          reject(
            new DesktopCliError(
              response.error.code,
              response.error.message,
              response.error.details,
            ),
          );
        }
      } catch (error: unknown) {
        fail(error instanceof Error ? error : new Error('Invalid response.'));
      }
    });
    socket.once('error', (error) => {
      const connectionError = error as NodeJS.ErrnoException;
      fail(
        connectionError.code === 'ENOENT' ||
          connectionError.code === 'ECONNREFUSED'
          ? new DesktopCliError(
              'DESKTOP_UNAVAILABLE',
              '雨课堂助手桌面端未运行或尚未准备完成。',
            )
          : error,
      );
    });
  });
}
