import type {
  AgentDirectSessionContext,
  AgentSessionMode,
  AgentSessionType,
  BatchAnalysisAgentRole,
  MCPAppPatchFormInput,
  MCPFindRelatedArticlesInput,
  MCPGetArticleFamilyInput,
  MCPGetArticleHistoryInput,
  MCPGetArticleInput,
  MCPGetBatchContextInput,
  MCPGetLocaleVariantInput,
  MCPGetPBIInput,
  MCPGetPBISubsetInput,
  MCPGetTemplateInput,
  MCPListArticleTemplatesInput,
  MCPListCategoriesInput,
  MCPListSectionsInput,
  MCPRecordAgentNotesInput,
  MCPSearchKbInput
} from './batch6';
import type { ProposalPlacementSuggestion } from './batch7';
import { ProposalReviewStatus } from './batch7';

export const DIRECT_READ_ACTION_TYPES = [
  'search_kb',
  'get_batch_context',
  'get_pbi',
  'get_pbi_subset',
  'get_article',
  'get_article_family',
  'get_locale_variant',
  'get_article_history',
  'find_related_articles',
  'list_categories',
  'list_sections',
  'list_article_templates',
  'get_template'
] as const;

export const DIRECT_MUTATION_ACTION_TYPES = [
  'record_agent_notes',
  'create_proposals',
  'patch_form'
] as const;

export const DIRECT_ACTION_TYPES = [
  ...DIRECT_READ_ACTION_TYPES,
  ...DIRECT_MUTATION_ACTION_TYPES
] as const;

export const DIRECT_BATCH_READ_ONLY_ACTION_TYPES = DIRECT_READ_ACTION_TYPES;

export const DIRECT_BATCH_WORKER_ACTION_TYPES = [
  ...DIRECT_READ_ACTION_TYPES,
  'create_proposals'
] as const;

export const DIRECT_ARTICLE_EDIT_ACTION_TYPES = DIRECT_READ_ACTION_TYPES;

export const DIRECT_ASSISTANT_READ_ACTION_TYPES = DIRECT_READ_ACTION_TYPES;

export const DIRECT_ASSISTANT_TEMPLATE_ACTION_TYPES = [
  ...DIRECT_READ_ACTION_TYPES,
  'patch_form'
] as const;

export type DirectReadActionType = (typeof DIRECT_READ_ACTION_TYPES)[number];
export type DirectMutationActionType = (typeof DIRECT_MUTATION_ACTION_TYPES)[number];
export type DirectActionType = (typeof DIRECT_ACTION_TYPES)[number];

export type DirectProposalMutationAction = 'create' | 'edit' | 'retire';

export interface DirectCreateProposalInput {
  itemId?: string;
  action: DirectProposalMutationAction;
  familyId?: string;
  localeVariantId?: string;
  sourceRevisionId?: string;
  targetTitle?: string;
  targetLocale?: string;
  confidenceScore?: number;
  note?: string;
  rationale?: string;
  rationaleSummary?: string;
  aiNotes?: string;
  suggestedPlacement?: ProposalPlacementSuggestion;
  sourceHtml?: string;
  proposedHtml?: string;
  relatedPbiIds?: string[];
  metadata?: unknown;
}

export interface DirectCreateProposalsInput {
  proposals: DirectCreateProposalInput[];
}

export interface DirectCreateProposalResultItem {
  itemId?: string;
  proposalId: string;
  action: DirectProposalMutationAction;
  targetTitle?: string;
  targetLocale?: string;
  localeVariantId?: string;
  familyId?: string;
  reviewStatus: ProposalReviewStatus;
  idempotencyKey: string;
}

export interface DirectCreateProposalsResult {
  workspaceId: string;
  batchId: string;
  sessionId: string;
  proposals: DirectCreateProposalResultItem[];
}

export interface DirectExecutorScope {
  localeVariantIds?: string[];
  familyIds?: string[];
}

export interface DirectExecutorContext {
  workspaceId: string;
  batchId?: string;
  sessionId: string;
  sessionType?: AgentSessionType;
  sessionMode?: AgentSessionMode;
  agentRole?: BatchAnalysisAgentRole;
  locale?: string;
  scope?: DirectExecutorScope;
  directContext?: AgentDirectSessionContext;
}

export interface DirectActionArgsMap {
  search_kb: Omit<MCPSearchKbInput, 'workspaceId'>;
  get_batch_context: Omit<MCPGetBatchContextInput, 'workspaceId'>;
  get_pbi: Omit<MCPGetPBIInput, 'workspaceId'>;
  get_pbi_subset: Omit<MCPGetPBISubsetInput, 'workspaceId'>;
  get_article: Omit<MCPGetArticleInput, 'workspaceId'>;
  get_article_family: Omit<MCPGetArticleFamilyInput, 'workspaceId'>;
  get_locale_variant: Omit<MCPGetLocaleVariantInput, 'workspaceId'>;
  get_article_history: Omit<MCPGetArticleHistoryInput, 'workspaceId'>;
  find_related_articles: Omit<MCPFindRelatedArticlesInput, 'workspaceId'>;
  list_categories: Omit<MCPListCategoriesInput, 'workspaceId'>;
  list_sections: Omit<MCPListSectionsInput, 'workspaceId'>;
  list_article_templates: Omit<MCPListArticleTemplatesInput, 'workspaceId'>;
  get_template: Omit<MCPGetTemplateInput, 'workspaceId'>;
  record_agent_notes: Omit<MCPRecordAgentNotesInput, 'workspaceId'>;
  create_proposals: DirectCreateProposalsInput;
  patch_form: Pick<MCPAppPatchFormInput, 'patch' | 'versionToken'>;
}

export type DirectActionRequest = {
  [TAction in DirectActionType]: {
    id: string;
    type: TAction;
    args: DirectActionArgsMap[TAction];
  };
}[DirectActionType];

export interface DirectActionRequestEnvelope {
  completionState: 'needs_action';
  isFinal: false;
  action: DirectActionRequest;
}

export interface DirectActionErrorPayload {
  code?: string;
  message: string;
}

export interface DirectActionExecutionRequest {
  context: DirectExecutorContext;
  action: DirectActionRequest;
}

export interface DirectActionExecutionResult {
  actionId: string;
  ok: boolean;
  data?: unknown;
  error?: DirectActionErrorPayload;
}

export interface DirectActionResultEnvelope {
  type: 'action_result';
  actionId: string;
  ok: boolean;
  data?: unknown;
  error?: DirectActionErrorPayload;
}

export type DirectTerminalCompletionState = 'blocked' | 'needs_user_input' | 'errored';

export interface DirectTerminalEnvelope {
  completionState: DirectTerminalCompletionState;
  isFinal: true;
  message: string;
  details?: unknown;
}
