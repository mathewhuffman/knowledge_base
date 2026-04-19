import { expect, test } from '@playwright/test';
import { AppRoute, type AiViewContext } from '@kb-vault/shared-types';
import { AiAssistantService } from '../src/main/services/ai-assistant-service';

function createService(mode: 'cli' | 'mcp' | 'direct' = 'cli') {
  return new AiAssistantService(
    {} as never,
    {} as never,
    async () => mode,
    {} as never
  );
}

function createContext(overrides?: Partial<AiViewContext>): AiViewContext {
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
    },
    ...overrides
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

  test('treats article proposal fetch deferrals as progress placeholders in reply selection', () => {
    const service = createService('mcp') as unknown as {
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
        text: 'I need to fetch the current article content before drafting the proposal.',
        streamedText: '{"command":"create_proposal","artifactType":"proposal_candidate","completionState":"completed","isFinal":true,"response":"Here is a proposal that appends hello world.","html":"<p>Original</p><p>hello world</p>","payload":{"proposedHtml":"<p>Original</p><p>hello world</p>"}}'
      },
      createContext({
        route: AppRoute.ARTICLE_EXPLORER,
        routeLabel: 'Article Explorer',
        subject: {
          type: 'article',
          id: 'locale-variant-1',
          title: 'Add Users to a Team',
          locale: 'en-us'
        },
        capabilities: {
          canChat: true,
          canCreateProposal: true,
          canPatchProposal: false,
          canPatchDraft: false,
          canPatchTemplate: false,
          canUseUnsavedWorkingState: false
        },
        backingData: {
          route: AppRoute.ARTICLE_EXPLORER,
          localeVariantId: 'locale-variant-1',
          sourceHtml: '<p>Original</p>'
        }
      }),
      'please add hello world to the bottom of this article'
    );

    expect(parsed.artifactType).toBe('proposal_candidate');
    expect(parsed.response).toBe('Here is a proposal that appends hello world.');
  });

  test('materializes compact article proposal html mutations into full proposed html locally', () => {
    const service = createService('mcp') as unknown as {
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
        payload?: Record<string, unknown>;
      };
      buildArtifactPayload: (
        parsed: {
          artifactType: string;
          response: string;
          summary: string;
          payload?: Record<string, unknown>;
          confidenceScore?: number;
          rationale?: string;
          title?: string;
          html?: string;
        },
        context: AiViewContext
      ) => { sourceHtml?: string; proposedHtml?: string; metadata?: Record<string, unknown> };
    };

    const context = createContext({
      route: AppRoute.ARTICLE_EXPLORER,
      routeLabel: 'Article Explorer',
      subject: {
        type: 'article',
        id: 'locale-variant-1',
        title: 'Change a User Area',
        locale: 'en-us'
      },
      capabilities: {
        canChat: true,
        canCreateProposal: true,
        canPatchProposal: false,
        canPatchDraft: false,
        canPatchTemplate: false,
        canUseUnsavedWorkingState: false
      },
      workingState: {
        kind: 'article_html',
        payload: {
          html: '<p>Original</p>'
        }
      },
      backingData: {
        route: AppRoute.ARTICLE_EXPLORER,
        localeVariantId: 'locale-variant-1',
        sourceHtml: '<p>Original</p>'
      }
    });

    const parsed = service.parseRuntimeResult(
      {
        text: JSON.stringify({
          command: 'create_proposal',
          artifactType: 'proposal_candidate',
          completionState: 'completed',
          isFinal: true,
          response: 'Here is a proposal candidate.',
          payload: {
            htmlMutations: [
              {
                type: 'append_html',
                html: '<p>hello world</p>'
              }
            ]
          }
        })
      },
      context,
      "please add 'hello world' to the bottom of this article"
    );

    const artifactPayload = service.buildArtifactPayload({
      ...parsed,
      summary: parsed.response
    }, context);

    expect(parsed.artifactType).toBe('proposal_candidate');
    expect(artifactPayload.sourceHtml).toBe('<p>Original</p>');
    expect(artifactPayload.proposedHtml).toBe('<p>Original</p><p>hello world</p>');
    expect(artifactPayload.metadata?.htmlMutations).toEqual([
      expect.objectContaining({
        type: 'append_html',
        html: '<p>hello world</p>'
      })
    ]);
  });

  test('prefers the full assistant envelope over a nested payload object in duplicated fenced JSON', () => {
    const service = createService('cli') as unknown as {
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
        payload?: Record<string, unknown>;
      };
    };

    const duplicatedEnvelope = [
      '```json',
      '{',
      '  "command": "create_proposal",',
      '  "artifactType": "proposal_candidate",',
      '  "completionState": "completed",',
      '  "isFinal": true,',
      '  "response": "Here is a proposal that appends hello world.",',
      '  "payload": {',
      '    "targetTitle": "All Stations Standards",',
      '    "targetLocale": "en-us",',
      '    "proposedHtml": "<p>Original</p><p>hello world</p>",',
      '    "confidenceScore": 0.99',
      '  }',
      '}',
      '```json',
      '{',
      '  "command": "create_proposal",',
      '  "artifactType": "proposal_candidate",',
      '  "completionState": "completed",',
      '  "isFinal": true,',
      '  "response": "Here is a proposal that appends hello world.",',
      '  "payload": {',
      '    "targetTitle": "All Stations Standards",',
      '    "targetLocale": "en-us",',
      '    "proposedHtml": "<p>Original</p><p>hello world</p>",',
      '    "confidenceScore": 0.99',
      '  }',
      '}',
      '```'
    ].join('\n');

    const parsed = service.parseRuntimeResult(
      {
        text: duplicatedEnvelope
      },
      createContext({
        route: AppRoute.ARTICLE_EXPLORER,
        routeLabel: 'Article Explorer',
        subject: {
          type: 'article',
          id: 'locale-variant-1',
          title: 'All Stations Standards',
          locale: 'en-us'
        },
        capabilities: {
          canChat: true,
          canCreateProposal: true,
          canPatchProposal: false,
          canPatchDraft: false,
          canPatchTemplate: false,
          canUseUnsavedWorkingState: false
        },
        backingData: {
          route: AppRoute.ARTICLE_EXPLORER,
          localeVariantId: 'locale-variant-1',
          sourceHtml: '<p>Original</p>'
        }
      }),
      "please add 'hello world' to the bottom of this article"
    );

    expect(parsed.artifactType).toBe('proposal_candidate');
    expect(parsed.completionState).toBe('completed');
    expect(parsed.response).toBe('Here is a proposal that appends hello world.');
    expect(parsed.payload?.proposedHtml).toBe('<p>Original</p><p>hello world</p>');
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

  test('downgrades a claimed Proposal Review success when the patch does not resolve to a real mutation', () => {
    const service = createService('mcp') as unknown as {
      parseRuntimeResult: (
        resultPayload: unknown,
        context: AiViewContext,
        userMessage: string,
        directWorkingStateMutationApplied?: boolean,
        transcriptFallbackText?: string,
        runtimeFailureMessage?: string
      ) => { artifactType: string; response: string; summary: string };
    };

    const parsed = service.parseRuntimeResult(
      {
        text: JSON.stringify({
          command: 'patch_proposal',
          artifactType: 'proposal_patch',
          completionState: 'completed',
          isFinal: true,
          response: 'Done — the "hello world" paragraph has been removed from the bottom of the proposal.',
          payload: {
            htmlMutations: [
              {
                type: 'remove_text',
                target: '<p>missing</p>',
                occurrence: 'last'
              }
            ]
          }
        })
      },
      createContext({
        route: AppRoute.PROPOSAL_REVIEW,
        routeLabel: 'Proposal Review',
        subject: {
          type: 'proposal',
          id: 'proposal-1',
          title: 'Edit User Area'
        },
        workingState: {
          kind: 'proposal_html',
          payload: {
            html: '<p>Original</p><p>hello world</p>'
          }
        },
        capabilities: {
          canChat: true,
          canCreateProposal: false,
          canPatchProposal: true,
          canPatchDraft: false,
          canPatchTemplate: false,
          canUseUnsavedWorkingState: true
        },
        backingData: {
          route: AppRoute.PROPOSAL_REVIEW,
          proposedHtml: '<p>Original</p><p>hello world</p>'
        }
      }),
      "ok please remove hello world at the bottom of this"
    );

    expect(parsed.artifactType).toBe('clarification_request');
    expect(parsed.response).toBe(
      'I did not apply that edit yet. Please try again, and I will return an explicit patch instead of a chat-only response.'
    );
    expect(parsed.summary).toBe('Assistant could not confirm a real content mutation.');
  });
});

test.describe('ai assistant service prompt builder', () => {
  test('builds an MCP-pure assistant prompt', () => {
    const service = createService('mcp') as unknown as {
      buildAskPrompt: (
        context: AiViewContext,
        message: string,
        messages: Array<{ role: string; messageKind: string; content: string }>,
        includeTranscript: boolean,
        kbAccessMode: 'cli' | 'mcp'
      ) => string;
    };

    const prompt = service.buildAskPrompt(
      createContext(),
      'Explain checklist workflows.',
      [],
      false,
      'mcp'
    );

    expect(prompt).toContain('KB access mode: mcp');
    expect(prompt).toContain('`search_kb`');
    expect(prompt).toContain('`get_article`');
    expect(prompt).not.toContain('kb search-kb');
    expect(prompt).not.toContain('kb app patch-form');
    expect(prompt).not.toContain('`kb` CLI commands');
  });

  test('builds a CLI-pure assistant prompt', () => {
    const service = createService('cli') as unknown as {
      buildAskPrompt: (
        context: AiViewContext,
        message: string,
        messages: Array<{ role: string; messageKind: string; content: string }>,
        includeTranscript: boolean,
        kbAccessMode: 'cli' | 'mcp'
      ) => string;
    };

    const prompt = service.buildAskPrompt(
      createContext(),
      'Explain checklist workflows.',
      [],
      false,
      'cli'
    );

    expect(prompt).toContain('KB access mode: cli');
    expect(prompt).toContain('kb search-kb');
    expect(prompt).toContain('kb app patch-form');
    expect(prompt).not.toContain('`search_kb`');
    expect(prompt).not.toContain('`app_patch_form`');
    expect(prompt).not.toContain('`app_get_form_schema`');
  });

  test('builds a Direct-pure assistant prompt', () => {
    const service = createService('direct') as unknown as {
      buildAskPrompt: (
        context: AiViewContext,
        message: string,
        messages: Array<{ role: string; messageKind: string; content: string }>,
        includeTranscript: boolean,
        kbAccessMode: 'cli' | 'mcp' | 'direct'
      ) => string;
    };

    const prompt = service.buildAskPrompt(
      createContext(),
      'Explain checklist workflows.',
      [],
      false,
      'direct'
    );

    expect(prompt).toContain('KB access mode: direct');
    expect(prompt).toContain('`needs_action`');
    expect(prompt).toContain('request `search_kb`');
    expect(prompt).toContain('request `get_article`');
    expect(prompt).not.toContain('kb search-kb');
    expect(prompt).not.toContain('`app_patch_form`');
    expect(prompt).not.toContain('`kb app patch-form`');
  });

  test('Proposal Review guidance prefers proposal_patch over live form mutation', () => {
    const service = createService('mcp') as unknown as {
      buildAskPrompt: (
        context: AiViewContext,
        message: string,
        messages: Array<{ role: string; messageKind: string; content: string }>,
        includeTranscript: boolean,
        kbAccessMode: 'cli' | 'mcp'
      ) => string;
    };

    const prompt = service.buildAskPrompt(
      createContext({
        route: AppRoute.PROPOSAL_REVIEW,
        routeLabel: 'Proposal Review',
        backingData: { route: AppRoute.PROPOSAL_REVIEW }
      }),
      'Tighten the proposal intro.',
      [],
      false,
      'mcp'
    );

    expect(prompt).toContain('prefer returning `command="patch_proposal"` with `artifactType="proposal_patch"`');
    expect(prompt).toContain('prefer targeted `payload.htmlMutations`');
    expect(prompt).not.toContain('preferred path is to directly mutate the current proposal working state');
    expect(prompt).not.toContain('Proposal Review should primarily use kb app patch-form');
    expect(prompt).not.toContain('`kb app get-form-schema`');
    expect(prompt).not.toContain('`kb app patch-form`');
    expect(prompt).not.toContain('kb search-kb');
  });

  test('Proposal Review guidance stays CLI-pure in CLI mode', () => {
    const service = createService('cli') as unknown as {
      buildAskPrompt: (
        context: AiViewContext,
        message: string,
        messages: Array<{ role: string; messageKind: string; content: string }>,
        includeTranscript: boolean,
        kbAccessMode: 'cli' | 'mcp'
      ) => string;
    };

    const prompt = service.buildAskPrompt(
      createContext({
        route: AppRoute.PROPOSAL_REVIEW,
        routeLabel: 'Proposal Review',
        backingData: { route: AppRoute.PROPOSAL_REVIEW }
      }),
      'Tighten the proposal intro.',
      [],
      false,
      'cli'
    );

    expect(prompt).toContain('prefer returning `command="patch_proposal"` with `artifactType="proposal_patch"`');
    expect(prompt).toContain('prefer targeted `payload.htmlMutations`');
    expect(prompt).not.toContain('`app_get_form_schema`');
    expect(prompt).not.toContain('`app_patch_form`');
    expect(prompt).not.toContain('`search_kb`');
  });

  test('Templates route uses CLI app commands in CLI mode', () => {
    const service = createService('cli') as unknown as {
      buildAskPrompt: (
        context: AiViewContext,
        message: string,
        messages: Array<{ role: string; messageKind: string; content: string }>,
        includeTranscript: boolean,
        kbAccessMode: 'cli' | 'mcp'
      ) => string;
    };

    const prompt = service.buildAskPrompt(
      createContext({
        route: AppRoute.TEMPLATES_AND_PROMPTS,
        routeLabel: 'Templates & Prompts',
        backingData: { route: AppRoute.TEMPLATES_AND_PROMPTS }
      }),
      'Update the tone rules.',
      [],
      false,
      'cli'
    );

    expect(prompt).toContain('`kb app get-form-schema`');
    expect(prompt).toContain('`kb app patch-form`');
    expect(prompt).not.toContain('`app_get_form_schema`');
    expect(prompt).not.toContain('`app_patch_form`');
  });

  test('Templates route uses MCP app mutation tools in MCP mode', () => {
    const service = createService('mcp') as unknown as {
      buildAskPrompt: (
        context: AiViewContext,
        message: string,
        messages: Array<{ role: string; messageKind: string; content: string }>,
        includeTranscript: boolean,
        kbAccessMode: 'cli' | 'mcp'
      ) => string;
    };

    const prompt = service.buildAskPrompt(
      createContext({
        route: AppRoute.TEMPLATES_AND_PROMPTS,
        routeLabel: 'Templates & Prompts',
        backingData: { route: AppRoute.TEMPLATES_AND_PROMPTS }
      }),
      'Update the tone rules.',
      [],
      false,
      'mcp'
    );

    expect(prompt).toContain('`app_get_form_schema`');
    expect(prompt).toContain('`app_patch_form`');
    expect(prompt).not.toContain('`kb app get-form-schema`');
    expect(prompt).not.toContain('`kb app patch-form`');
  });

  test('Templates route uses direct patch actions in Direct mode', () => {
    const service = createService('direct') as unknown as {
      buildAskPrompt: (
        context: AiViewContext,
        message: string,
        messages: Array<{ role: string; messageKind: string; content: string }>,
        includeTranscript: boolean,
        kbAccessMode: 'cli' | 'mcp' | 'direct'
      ) => string;
    };

    const prompt = service.buildAskPrompt(
      createContext({
        route: AppRoute.TEMPLATES_AND_PROMPTS,
        routeLabel: 'Templates & Prompts',
        capabilities: {
          canChat: true,
          canCreateProposal: false,
          canPatchProposal: false,
          canPatchDraft: false,
          canPatchTemplate: true,
          canUseUnsavedWorkingState: true
        },
        backingData: { route: AppRoute.TEMPLATES_AND_PROMPTS }
      }),
      'Update the tone rules.',
      [],
      false,
      'direct'
    );

    expect(prompt).toContain('request `patch_form`');
    expect(prompt).toContain('After a successful `patch_form` action result');
    expect(prompt).not.toContain('`app_get_form_schema`');
    expect(prompt).not.toContain('`app_patch_form`');
    expect(prompt).not.toContain('`kb app get-form-schema`');
    expect(prompt).not.toContain('`kb app patch-form`');
  });

  test('Drafts route keeps CLI guidance free of MCP tool names', () => {
    const service = createService('cli') as unknown as {
      buildAskPrompt: (
        context: AiViewContext,
        message: string,
        messages: Array<{ role: string; messageKind: string; content: string }>,
        includeTranscript: boolean,
        kbAccessMode: 'cli' | 'mcp'
      ) => string;
    };

    const prompt = service.buildAskPrompt(
      createContext({
        route: AppRoute.DRAFTS,
        routeLabel: 'Drafts',
        subject: {
          type: 'draft_branch',
          id: 'draft-1',
          title: 'Draft One',
          locale: 'en-us'
        },
        workingState: {
          kind: 'article_html',
          payload: {
            html: '<p>Current draft</p>'
          }
        },
        capabilities: {
          canChat: true,
          canCreateProposal: false,
          canPatchProposal: false,
          canPatchDraft: true,
          canPatchTemplate: false,
          canUseUnsavedWorkingState: true
        },
        backingData: {
          route: AppRoute.DRAFTS,
          branchId: 'draft-1'
        }
      }),
      'Tighten this draft.',
      [],
      false,
      'cli'
    );

    expect(prompt).toContain('KB access mode: cli');
    expect(prompt).toContain('Never use direct MCP tool names');
    expect(prompt).toContain('For draft edits, return the full replacement HTML in "html".');
    expect(prompt).not.toContain('`search_kb`');
    expect(prompt).not.toContain('`app_get_form_schema`');
    expect(prompt).not.toContain('`app_patch_form`');
  });

  test('Drafts route keeps MCP guidance free of CLI syntax', () => {
    const service = createService('mcp') as unknown as {
      buildAskPrompt: (
        context: AiViewContext,
        message: string,
        messages: Array<{ role: string; messageKind: string; content: string }>,
        includeTranscript: boolean,
        kbAccessMode: 'cli' | 'mcp'
      ) => string;
    };

    const prompt = service.buildAskPrompt(
      createContext({
        route: AppRoute.DRAFTS,
        routeLabel: 'Drafts',
        subject: {
          type: 'draft_branch',
          id: 'draft-1',
          title: 'Draft One',
          locale: 'en-us'
        },
        workingState: {
          kind: 'article_html',
          payload: {
            html: '<p>Current draft</p>'
          }
        },
        capabilities: {
          canChat: true,
          canCreateProposal: false,
          canPatchProposal: false,
          canPatchDraft: true,
          canPatchTemplate: false,
          canUseUnsavedWorkingState: true
        },
        backingData: {
          route: AppRoute.DRAFTS,
          branchId: 'draft-1'
        }
      }),
      'Tighten this draft.',
      [],
      false,
      'mcp'
    );

    expect(prompt).toContain('KB access mode: mcp');
    expect(prompt).toContain('`search_kb`');
    expect(prompt).toContain('For draft edits, return the full replacement HTML in "html".');
    expect(prompt).not.toContain('kb search-kb');
    expect(prompt).not.toContain('`kb app get-form-schema`');
    expect(prompt).not.toContain('`kb app patch-form`');
  });

  test('article proposal guidance in MCP mode supports compact html mutations', () => {
    const service = createService('mcp') as unknown as {
      buildAskPrompt: (
        context: AiViewContext,
        message: string,
        messages: Array<{ role: string; messageKind: string; content: string }>,
        includeTranscript: boolean,
        kbAccessMode: 'cli' | 'mcp'
      ) => string;
    };

    const prompt = service.buildAskPrompt(
      createContext({
        route: AppRoute.ARTICLE_EXPLORER,
        routeLabel: 'Article Explorer',
        subject: {
          type: 'article',
          id: 'locale-variant-1',
          title: 'Add a Team Leader to a Team',
          locale: 'en-us'
        },
        capabilities: {
          canChat: true,
          canCreateProposal: true,
          canPatchProposal: false,
          canPatchDraft: false,
          canPatchTemplate: false,
          canUseUnsavedWorkingState: false
        },
        backingData: {
          route: AppRoute.ARTICLE_EXPLORER,
          localeVariantId: 'locale-variant-1'
        }
      }),
      'Add hello world to the bottom of this article and draft a proposal.',
      [],
      false,
      'mcp'
    );

    expect(prompt).toContain('fetch the current article with `get_article`');
    expect(prompt).toContain('prefer targeted `payload.htmlMutations`');
    expect(prompt).toContain('app will materialize the final HTML locally');
    expect(prompt).toContain('For broad rewrites, return the full final article HTML');
    expect(prompt).toContain('Do not use `payload.lineEdits` for `proposal_candidate`');
    expect(prompt).toContain('Do not claim KB Vault MCP tools are unavailable because they are not shown in a generic tool list');
  });

  test('article proposal guidance in CLI mode supports compact html mutations', () => {
    const service = createService('cli') as unknown as {
      buildAskPrompt: (
        context: AiViewContext,
        message: string,
        messages: Array<{ role: string; messageKind: string; content: string }>,
        includeTranscript: boolean,
        kbAccessMode: 'cli' | 'mcp'
      ) => string;
    };

    const prompt = service.buildAskPrompt(
      createContext({
        route: AppRoute.ARTICLE_EXPLORER,
        routeLabel: 'Article Explorer',
        subject: {
          type: 'article',
          id: 'locale-variant-1',
          title: 'Add a Team Leader to a Team',
          locale: 'en-us'
        },
        capabilities: {
          canChat: true,
          canCreateProposal: true,
          canPatchProposal: false,
          canPatchDraft: false,
          canPatchTemplate: false,
          canUseUnsavedWorkingState: false
        },
        backingData: {
          route: AppRoute.ARTICLE_EXPLORER,
          localeVariantId: 'locale-variant-1'
        }
      }),
      'Add hello world to the bottom of this article and draft a proposal.',
      [],
      false,
      'cli'
    );

    expect(prompt).toContain('fetch the current article with `kb get-article`');
    expect(prompt).toContain('prefer targeted `payload.htmlMutations`');
    expect(prompt).toContain('app will materialize the final HTML locally');
    expect(prompt).toContain('For broad rewrites, return the full final article HTML');
    expect(prompt).toContain('Do not use `payload.lineEdits` for `proposal_candidate`');
    expect(prompt).toContain('Do not claim direct KB access is unavailable because it is not shown in a generic tool list');
    expect(prompt).not.toContain('fetch the current article with `get_article`');
    expect(prompt).not.toContain('`search_kb`');
  });

  test('article proposal guidance in Direct mode supports compact html mutations', () => {
    const service = createService('direct') as unknown as {
      buildAskPrompt: (
        context: AiViewContext,
        message: string,
        messages: Array<{ role: string; messageKind: string; content: string }>,
        includeTranscript: boolean,
        kbAccessMode: 'cli' | 'mcp' | 'direct'
      ) => string;
    };

    const prompt = service.buildAskPrompt(
      createContext({
        route: AppRoute.ARTICLE_EXPLORER,
        routeLabel: 'Article Explorer',
        subject: {
          type: 'article',
          id: 'locale-variant-1',
          title: 'Add a Team Leader to a Team',
          locale: 'en-us'
        },
        capabilities: {
          canChat: true,
          canCreateProposal: true,
          canPatchProposal: false,
          canPatchDraft: false,
          canPatchTemplate: false,
          canUseUnsavedWorkingState: false
        },
        backingData: {
          route: AppRoute.ARTICLE_EXPLORER,
          localeVariantId: 'locale-variant-1'
        }
      }),
      'Add hello world to the bottom of this article and draft a proposal.',
      [],
      false,
      'direct'
    );

    expect(prompt).toContain('request `get_article`');
    expect(prompt).toContain('prefer targeted `payload.htmlMutations`');
    expect(prompt).toContain('app will materialize the final HTML locally');
    expect(prompt).toContain('Do not claim direct KB actions are unavailable');
    expect(prompt).not.toContain('fetch the current article with `kb get-article`');
    expect(prompt).not.toContain('`app_patch_form`');
  });

  test('article proposal prompt includes full current article HTML when it is already in context', () => {
    const service = createService('mcp') as unknown as {
      buildAskPrompt: (
        context: AiViewContext,
        message: string,
        messages: Array<{ role: string; messageKind: string; content: string }>,
        includeTranscript: boolean,
        kbAccessMode: 'cli' | 'mcp'
      ) => string;
    };

    const prompt = service.buildAskPrompt(
      createContext({
        route: AppRoute.ARTICLE_EXPLORER,
        routeLabel: 'Article Explorer',
        subject: {
          type: 'article',
          id: 'locale-variant-1',
          title: 'Add Users to a Team',
          locale: 'en-us'
        },
        workingState: {
          kind: 'article_html',
          payload: {
            html: '<p>Current article</p>'
          }
        },
        capabilities: {
          canChat: true,
          canCreateProposal: true,
          canPatchProposal: false,
          canPatchDraft: false,
          canPatchTemplate: false,
          canUseUnsavedWorkingState: false
        },
        backingData: {
          route: AppRoute.ARTICLE_EXPLORER,
          localeVariantId: 'locale-variant-1',
          sourceHtml: '<p>Current article</p>'
        }
      }),
      'please add hello world to the bottom of this article',
      [],
      false,
      'mcp'
    );

    expect(prompt).toContain('Current article HTML (full source for proposal drafting):');
    expect(prompt).toContain('<p>Current article</p>');
  });
});
