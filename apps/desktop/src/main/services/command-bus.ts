import { randomUUID } from 'node:crypto';
import { AppErrorCode, createErrorResult, type RpcRequest, type RpcResponse } from '@kb-vault/shared-types';
import { logger } from './logger';

type CommandHandler = (input: unknown, requestId: string) => Promise<RpcResponse>;

export class CommandBus {
  private handlers = new Map<string, CommandHandler>();

  register(method: string, handler: CommandHandler) {
    this.handlers.set(method, handler);
  }

  async execute(request: RpcRequest): Promise<RpcResponse> {
    const requestId = request.requestId ?? randomUUID();
    const handler = this.handlers.get(request.method);
    const startedAt = Date.now();

    if (!handler) {
      logger.warn('IPC command not registered', { requestId, method: request.method });
      return createErrorResult(AppErrorCode.UNKNOWN_COMMAND, `No handler for method: ${request.method}`, requestId);
    }

    try {
      logger.info('IPC command start', { requestId, method: request.method });
      const response = await handler(request.payload, requestId);
      const elapsedMs = Date.now() - startedAt;
      logger.info('IPC command complete', { requestId, method: request.method, elapsedMs, ok: response.ok });
      return { ...response, requestId, timestamp: new Date().toISOString() };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      logger.error('IPC command failed', {
        requestId,
        method: request.method,
        elapsedMs,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error), requestId);
    }
  }
}
