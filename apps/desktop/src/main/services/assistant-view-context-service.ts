import type {
  AiAssistantContextChangedEvent,
  AiAssistantContextGetResponse,
  AiAssistantContextPublishRequest
} from '@kb-vault/shared-types';
import { logger } from './logger';

type ContextListener = (event: AiAssistantContextChangedEvent) => void;

export class AssistantViewContextService {
  private currentEvent: AiAssistantContextChangedEvent = {};
  private readonly listeners = new Set<ContextListener>();

  getCurrent(): AiAssistantContextGetResponse {
    return { ...this.currentEvent };
  }

  publish(input: AiAssistantContextPublishRequest): AiAssistantContextGetResponse {
    const event: AiAssistantContextChangedEvent = {
      context: input.context ?? undefined,
      publishedAtUtc: new Date().toISOString(),
      sourceWindowRole: input.sourceWindowRole
    };

    this.currentEvent = event;
    logger.info('assistant-view-context.publish', {
      route: event.context?.route ?? null,
      workspaceId: event.context?.workspaceId ?? null,
      subjectType: event.context?.subject?.type ?? null,
      subjectId: event.context?.subject?.id ?? null,
      sourceWindowRole: event.sourceWindowRole ?? null
    });
    this.emit(event);
    return this.getCurrent();
  }

  subscribe(listener: ContextListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: AiAssistantContextChangedEvent): void {
    for (const listener of this.listeners) {
      listener({ ...event });
    }
  }
}
