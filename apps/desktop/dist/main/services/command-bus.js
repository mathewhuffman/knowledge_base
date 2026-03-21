"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandBus = void 0;
const node_crypto_1 = require("node:crypto");
const shared_types_1 = require("@kb-vault/shared-types");
const logger_1 = require("./logger");
class CommandBus {
    handlers = new Map();
    register(method, handler) {
        this.handlers.set(method, handler);
    }
    async execute(request) {
        const requestId = request.requestId ?? (0, node_crypto_1.randomUUID)();
        const handler = this.handlers.get(request.method);
        const startedAt = Date.now();
        if (!handler) {
            logger_1.logger.warn('IPC command not registered', { requestId, method: request.method });
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.UNKNOWN_COMMAND, `No handler for method: ${request.method}`, requestId);
        }
        try {
            logger_1.logger.info('IPC command start', { requestId, method: request.method });
            const response = await handler(request.payload, requestId);
            const elapsedMs = Date.now() - startedAt;
            logger_1.logger.info('IPC command complete', { requestId, method: request.method, elapsedMs, ok: response.ok });
            return { ...response, requestId, timestamp: new Date().toISOString() };
        }
        catch (error) {
            const elapsedMs = Date.now() - startedAt;
            logger_1.logger.error('IPC command failed', {
                requestId,
                method: request.method,
                elapsedMs,
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error), requestId);
        }
    }
}
exports.CommandBus = CommandBus;
