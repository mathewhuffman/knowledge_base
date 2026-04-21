"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssistantViewContextService = void 0;
const logger_1 = require("./logger");
class AssistantViewContextService {
    currentEvent = {};
    listeners = new Set();
    getCurrent() {
        return { ...this.currentEvent };
    }
    publish(input) {
        const event = {
            context: input.context ?? undefined,
            publishedAtUtc: new Date().toISOString(),
            sourceWindowRole: input.sourceWindowRole
        };
        this.currentEvent = event;
        logger_1.logger.info('assistant-view-context.publish', {
            route: event.context?.route ?? null,
            workspaceId: event.context?.workspaceId ?? null,
            subjectType: event.context?.subject?.type ?? null,
            subjectId: event.context?.subject?.id ?? null,
            sourceWindowRole: event.sourceWindowRole ?? null
        });
        this.emit(event);
        return this.getCurrent();
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    emit(event) {
        for (const listener of this.listeners) {
            listener({ ...event });
        }
    }
}
exports.AssistantViewContextService = AssistantViewContextService;
