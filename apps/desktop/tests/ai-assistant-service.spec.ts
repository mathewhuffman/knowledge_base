import { expect, test } from '@playwright/test';
import { AppRoute, type AiViewContext } from '@kb-vault/shared-types';
import { AiAssistantService } from '../src/main/services/ai-assistant-service';

function createService() {
  return new AiAssistantService(
    {} as never,
    {} as never,
    async () => 'cli',
    {} as never
  );
}

function createContext(): AiViewContext {
  return {
    workspaceId: 'workspace-1',
    route: AppRoute.KB_VAULT_HOME,
    routeLabel: 'KB Vault Home',
    subject: {
      type: 'workspace',
      id: 'workspace-1'
    },
    workingState: {
      kind: 'none',
      payload: null
    },
    capabilities: {
      canChat: true,
      canCreateProposal: false,
      canPatchProposal: false,
      canPatchDraft: false,
      canPatchTemplate: false,
      canUseUnsavedWorkingState: false
    },
    backingData: {
      route: AppRoute.KB_VAULT_HOME
    }
  };
}

test.describe('ai assistant service reply selection', () => {
  test('prefers the direct runtime reply over corrupt transcript fallback text', () => {
    const service = createService() as unknown as {
      parseRuntimeResult: (
        resultPayload: unknown,
        context: AiViewContext,
        userMessage: string,
        directWorkingStateMutationApplied?: boolean,
        transcriptFallbackText?: string,
        runtimeFailureMessage?: string
      ) => { artifactType: string; response: string };
    };

    const parsed = service.parseRuntimeResult(
      {
        text: 'Areas are the main container. Schedules define when an area runs, and setups define how that area is organized.',
        streamedText: 'Areas are the main container. It represents a of operation section the where people work. =Area the section of the business'
      },
      createContext(),
      'What is the relationship between areas, schedules, and setups?',
      false,
      'Areas are the main container. It represents a of operation section the where people work. =Area the section of the business'
    );

    expect(parsed.artifactType).toBe('informational_response');
    expect(parsed.response).toBe(
      'Areas are the main container. Schedules define when an area runs, and setups define how that area is organized.'
    );
  });

  test('falls back to streamed text when the direct runtime reply is only a progress placeholder', () => {
    const service = createService() as unknown as {
      parseRuntimeResult: (
        resultPayload: unknown,
        context: AiViewContext,
        userMessage: string,
        directWorkingStateMutationApplied?: boolean,
        transcriptFallbackText?: string,
        runtimeFailureMessage?: string
      ) => { artifactType: string; response: string };
    };

    const parsed = service.parseRuntimeResult(
      {
        text: 'Gathering KB evidence via the CLI and then returning only the structured JSON plan.',
        streamedText: 'Schedules define when an area is active. Setups define how that area is organized.'
      },
      createContext(),
      'Explain areas, schedules, and setups.'
    );

    expect(parsed.artifactType).toBe('informational_response');
    expect(parsed.response).toBe(
      'Schedules define when an area is active. Setups define how that area is organized.'
    );
  });

  test('prefers a later completed JSON envelope over an earlier needs-user-input envelope', () => {
    const service = createService() as unknown as {
      parseRuntimeResult: (
        resultPayload: unknown,
        context: AiViewContext,
        userMessage: string,
        directWorkingStateMutationApplied?: boolean,
        transcriptFallbackText?: string,
        runtimeFailureMessage?: string
      ) => {
        artifactType: string;
        response: string;
        completionState: string;
        isFinal?: boolean;
        title?: string;
      };
    };

    const parsed = service.parseRuntimeResult(
      {
        text: '{"command":"none","artifactType":"clarification_request","completionState":"needs_user_input","isFinal":true,"title":"Checklist Feature Research","response":"I can finish this, but I do not have the KB article results."}',
        streamedText: '{"command":"none","artifactType":"informational_response","completionState":"completed","isFinal":true,"title":"How To Use Checklists","response":"Create the checklist, assign it, complete it, and review reporting."}'
      },
      createContext(),
      'please go do research on our checklist feature and tell me how to use it'
    );

    expect(parsed.artifactType).toBe('informational_response');
    expect(parsed.completionState).toBe('completed');
    expect(parsed.isFinal).toBe(true);
    expect(parsed.title).toBe('How To Use Checklists');
    expect(parsed.response).toBe('Create the checklist, assign it, complete it, and review reporting.');
  });

  test('keeps Terminal tool events in assistant audit metadata so the Thoughts block can render', () => {
    const service = createService() as unknown as {
      buildAssistantMessageAuditMetadata: (audit: {
        thoughtText: string;
        toolEvents: Array<{ toolName?: string; toolStatus?: string; resourceLabel?: string }>;
        completionState?: string;
        isFinal?: boolean;
      }) => { toolEvents?: Array<{ toolName?: string; toolStatus?: string; resourceLabel?: string }> } | undefined;
    };

    const metadata = service.buildAssistantMessageAuditMetadata({
      thoughtText: '',
      toolEvents: [{ toolName: 'Terminal', toolStatus: 'pending' }],
      completionState: 'needs_user_input',
      isFinal: true
    });

    expect(metadata?.toolEvents).toEqual([
      expect.objectContaining({
        toolName: 'Terminal',
        toolStatus: 'pending'
      })
    ]);
  });
});
