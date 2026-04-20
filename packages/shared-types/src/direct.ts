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
import {
  MCP_FIND_RELATED_ARTICLES_INPUT_SCHEMA,
  MCP_GET_ARTICLE_FAMILY_INPUT_SCHEMA,
  MCP_GET_ARTICLE_HISTORY_INPUT_SCHEMA,
  MCP_GET_ARTICLE_INPUT_SCHEMA,
  MCP_GET_BATCH_CONTEXT_INPUT_SCHEMA,
  MCP_GET_LOCALE_VARIANT_INPUT_SCHEMA,
  MCP_GET_PBI_INPUT_SCHEMA,
  MCP_GET_PBI_SUBSET_INPUT_SCHEMA,
  MCP_GET_TEMPLATE_INPUT_SCHEMA,
  MCP_LIST_ARTICLE_TEMPLATES_INPUT_SCHEMA,
  MCP_LIST_CATEGORIES_INPUT_SCHEMA,
  MCP_LIST_SECTIONS_INPUT_SCHEMA,
  MCP_RECORD_AGENT_NOTES_INPUT_SCHEMA,
  MCP_SEARCH_KB_INPUT_SCHEMA
} from './batch6';
import type { ProposalPlacementSuggestion } from './batch7';
import { ProposalReviewStatus } from './batch7';
import { MCP_APP_PATCH_FORM_INPUT_SCHEMA } from './app-working-state';

export const DIRECT_READ_ACTION_TYPES = [
  'search_kb',
  'get_explorer_tree',
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
  get_explorer_tree: Record<string, never>;
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

interface DirectActionJsonSchema {
  type?: string | readonly string[];
  enum?: readonly unknown[];
  properties?: Record<string, DirectActionJsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: DirectActionJsonSchema;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  minProperties?: number;
  anyOf?: readonly DirectActionJsonSchema[];
  oneOf?: readonly DirectActionJsonSchema[];
}

export interface DirectActionDefinition {
  description: string;
  argsHint: string;
  usageHint?: string;
  inputSchema: DirectActionJsonSchema;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneSchema(schema: DirectActionJsonSchema | undefined): DirectActionJsonSchema {
  if (!schema || typeof schema !== 'object') {
    return {};
  }
  const properties = schema.properties
    ? Object.fromEntries(
        Object.entries(schema.properties).map(([key, value]) => [key, cloneSchema(value)])
      )
    : undefined;
  return {
    ...schema,
    ...(properties ? { properties } : {}),
    ...(schema.required ? { required: [...schema.required] } : {}),
    ...(schema.enum ? { enum: [...schema.enum] } : {}),
    ...(schema.items ? { items: cloneSchema(schema.items) } : {}),
    ...(schema.anyOf ? { anyOf: schema.anyOf.map((entry) => cloneSchema(entry)) } : {}),
    ...(schema.oneOf ? { oneOf: schema.oneOf.map((entry) => cloneSchema(entry)) } : {})
  };
}

function omitObjectSchemaProperties(
  schema: DirectActionJsonSchema,
  omittedKeys: readonly string[]
): DirectActionJsonSchema {
  const cloned = cloneSchema(schema);
  if (!cloned.properties) {
    return cloned;
  }
  const properties = { ...cloned.properties };
  for (const key of omittedKeys) {
    delete properties[key];
  }
  return {
    ...cloned,
    properties,
    required: (cloned.required ?? []).filter((key) => !omittedKeys.includes(key))
  };
}

function pickObjectSchemaProperties(
  schema: DirectActionJsonSchema,
  pickedKeys: readonly string[],
  requiredKeys: readonly string[] = []
): DirectActionJsonSchema {
  const cloned = cloneSchema(schema);
  const properties = Object.fromEntries(
    pickedKeys
      .filter((key) => cloned.properties?.[key])
      .map((key) => [key, cloneSchema(cloned.properties?.[key])])
  );
  return {
    ...cloned,
    properties,
    required: [...requiredKeys]
  };
}

function formatSchemaPath(path: string): string {
  return path === 'input' ? 'args' : path.replace(/^input\./, '');
}

function validateSchema(value: unknown, schema: DirectActionJsonSchema | undefined, path = 'input'): ValidationResult {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { valid: true };
  }

  const typeList = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];

  if (typeList.length > 0) {
    const matchesType = typeList.some((typeName) => {
      switch (typeName) {
        case 'object':
          return isRecord(value);
        case 'array':
          return Array.isArray(value);
        case 'string':
          return typeof value === 'string';
        case 'number':
          return typeof value === 'number' && Number.isFinite(value);
        case 'integer':
          return typeof value === 'number' && Number.isInteger(value);
        case 'boolean':
          return typeof value === 'boolean';
        case 'null':
          return value === null;
        default:
          return true;
      }
    });

    if (!matchesType) {
      return {
        valid: false,
        error: `${formatSchemaPath(path)} must be ${typeList.join(' or ')}`
      };
    }
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const matched = schema.enum.some((candidate) => candidate === value);
    if (!matched) {
      return {
        valid: false,
        error: `${formatSchemaPath(path)} must be one of: ${schema.enum.map(String).join(', ')}`
      };
    }
  }

  if (typeof schema.minLength === 'number' && typeof value === 'string' && value.length < schema.minLength) {
    return {
      valid: false,
      error: `${formatSchemaPath(path)} must be at least ${schema.minLength} characters`
    };
  }

  if (typeof schema.maxLength === 'number' && typeof value === 'string' && value.length > schema.maxLength) {
    return {
      valid: false,
      error: `${formatSchemaPath(path)} must be at most ${schema.maxLength} characters`
    };
  }

  if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) {
    return {
      valid: false,
      error: `${formatSchemaPath(path)} must be >= ${schema.minimum}`
    };
  }

  if (typeof schema.maximum === 'number' && typeof value === 'number' && value > schema.maximum) {
    return {
      valid: false,
      error: `${formatSchemaPath(path)} must be <= ${schema.maximum}`
    };
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      return {
        valid: false,
        error: `${formatSchemaPath(path)} must contain at least ${schema.minItems} item(s)`
      };
    }
    if (schema.items) {
      for (let index = 0; index < value.length; index += 1) {
        const nested = validateSchema(value[index], schema.items, `${path}[${index}]`);
        if (!nested.valid) {
          return nested;
        }
      }
    }
  }

  if (isRecord(value)) {
    if (typeof schema.minProperties === 'number' && Object.keys(value).length < schema.minProperties) {
      return {
        valid: false,
        error: `${formatSchemaPath(path)} must include at least ${schema.minProperties} field(s)`
      };
    }

    const properties = schema.properties ?? {};
    for (const requiredKey of schema.required ?? []) {
      if (!(requiredKey in value)) {
        const nestedPath = path === 'input' ? `input.${requiredKey}` : `${path}.${requiredKey}`;
        return {
          valid: false,
          error: `${formatSchemaPath(nestedPath)} is required`
        };
      }
    }

    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!(key in value)) {
        continue;
      }
      const nested = validateSchema(value[key], propertySchema, path === 'input' ? `input.${key}` : `${path}.${key}`);
      if (!nested.valid) {
        return nested;
      }
    }

    if (schema.additionalProperties === false) {
      const allowedKeys = new Set(Object.keys(properties));
      for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) {
          return {
            valid: false,
            error: `${formatSchemaPath(path)} has unexpected property "${key}"`
          };
        }
      }
    }
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const anyValid = schema.anyOf.some((candidate) => validateSchema(value, candidate, path).valid);
    if (!anyValid) {
      return {
        valid: false,
        error: `${formatSchemaPath(path)} must satisfy at least one allowed input shape`
      };
    }
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const matchingSchemas = schema.oneOf.filter((candidate) => validateSchema(value, candidate, path).valid);
    if (matchingSchemas.length !== 1) {
      return {
        valid: false,
        error: `${formatSchemaPath(path)} must satisfy exactly one allowed input shape`
      };
    }
  }

  return { valid: true };
}

const DIRECT_GET_EXPLORER_TREE_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {}
} as const satisfies DirectActionJsonSchema;

const DIRECT_CREATE_PROPOSALS_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['proposals'],
  properties: {
    proposals: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          itemId: { type: 'string', minLength: 1 },
          action: { type: 'string', enum: ['create', 'edit', 'retire'] },
          familyId: { type: 'string', minLength: 1 },
          localeVariantId: { type: 'string', minLength: 1 },
          sourceRevisionId: { type: 'string', minLength: 1 },
          targetTitle: { type: 'string', minLength: 1 },
          targetLocale: { type: 'string', minLength: 1 },
          confidenceScore: { type: 'number', minimum: 0, maximum: 1 },
          note: { type: 'string', minLength: 1 },
          rationale: { type: 'string', minLength: 1 },
          rationaleSummary: { type: 'string', minLength: 1 },
          aiNotes: { type: 'string', minLength: 1 },
          suggestedPlacement: {},
          sourceHtml: { type: 'string', minLength: 1 },
          proposedHtml: { type: 'string', minLength: 1 },
          relatedPbiIds: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', minLength: 1 }
          },
          metadata: {}
        }
      }
    }
  }
} as const satisfies DirectActionJsonSchema;

export const DIRECT_ACTION_DEFINITIONS: Record<DirectActionType, DirectActionDefinition> = {
  search_kb: {
    description: 'Search the local KB cache for likely article candidates.',
    argsHint: '`query` or one of `localeVariantIds`, `familyIds`, `revisionIds`; optional `includeArchived`.',
    usageHint: 'Start here for ordinary KB questions. If results are empty or weak, use `get_explorer_tree` to browse titles and ids.',
    inputSchema: omitObjectSchemaProperties(MCP_SEARCH_KB_INPUT_SCHEMA, ['workspaceId'])
  },
  get_explorer_tree: {
    description: 'Browse the current KB article tree with titles, localeVariantIds, and revisionIds.',
    argsHint: 'No args. Send `{}`.',
    usageHint: 'Use when search returns no useful matches or when you need to browse before choosing an article.',
    inputSchema: DIRECT_GET_EXPLORER_TREE_INPUT_SCHEMA
  },
  get_batch_context: {
    description: 'Load batch metadata and scoped row summary.',
    argsHint: '`batchId`.',
    inputSchema: omitObjectSchemaProperties(MCP_GET_BATCH_CONTEXT_INPUT_SCHEMA, ['workspaceId'])
  },
  get_pbi: {
    description: 'Load one PBI record from the active batch.',
    argsHint: '`pbiId`.',
    inputSchema: omitObjectSchemaProperties(MCP_GET_PBI_INPUT_SCHEMA, ['workspaceId'])
  },
  get_pbi_subset: {
    description: 'Load a subset of PBI rows from the active batch.',
    argsHint: '`batchId`; optional integer `rowNumbers` array.',
    inputSchema: omitObjectSchemaProperties(MCP_GET_PBI_SUBSET_INPUT_SCHEMA, ['workspaceId'])
  },
  get_article: {
    description: 'Load one article payload.',
    argsHint: '`localeVariantId` or `revisionId`.',
    usageHint: 'Use after `search_kb` or `get_explorer_tree` identifies a specific article.',
    inputSchema: omitObjectSchemaProperties(MCP_GET_ARTICLE_INPUT_SCHEMA, ['workspaceId'])
  },
  get_article_family: {
    description: 'Load article-family metadata and locale context.',
    argsHint: '`familyId`.',
    inputSchema: omitObjectSchemaProperties(MCP_GET_ARTICLE_FAMILY_INPUT_SCHEMA, ['workspaceId'])
  },
  get_locale_variant: {
    description: 'Load one locale variant and its metadata.',
    argsHint: '`localeVariantId`.',
    inputSchema: omitObjectSchemaProperties(MCP_GET_LOCALE_VARIANT_INPUT_SCHEMA, ['workspaceId'])
  },
  get_article_history: {
    description: 'Load revision history for one locale variant.',
    argsHint: '`localeVariantId`.',
    inputSchema: omitObjectSchemaProperties(MCP_GET_ARTICLE_HISTORY_INPUT_SCHEMA, ['workspaceId'])
  },
  find_related_articles: {
    description: 'Load persisted related-article evidence.',
    argsHint: '`query` or one of `articleId`, `familyId`, `batchId`; optional `max`, `minScore`, `includeEvidence`.',
    inputSchema: omitObjectSchemaProperties(MCP_FIND_RELATED_ARTICLES_INPUT_SCHEMA, ['workspaceId'])
  },
  list_categories: {
    description: 'List KB categories for a locale.',
    argsHint: '`locale`.',
    inputSchema: omitObjectSchemaProperties(MCP_LIST_CATEGORIES_INPUT_SCHEMA, ['workspaceId'])
  },
  list_sections: {
    description: 'List KB sections within one category.',
    argsHint: '`locale` and integer `categoryId`.',
    usageHint: 'Only use after you already know the categoryId. Do not call this with missing locale or categoryId.',
    inputSchema: omitObjectSchemaProperties(MCP_LIST_SECTIONS_INPUT_SCHEMA, ['workspaceId'])
  },
  list_article_templates: {
    description: 'List template packs in the workspace.',
    argsHint: 'Optional `locale` and `includeInactive`.',
    inputSchema: omitObjectSchemaProperties(MCP_LIST_ARTICLE_TEMPLATES_INPUT_SCHEMA, ['workspaceId'])
  },
  get_template: {
    description: 'Load one template pack payload.',
    argsHint: '`templatePackId`.',
    inputSchema: omitObjectSchemaProperties(MCP_GET_TEMPLATE_INPUT_SCHEMA, ['workspaceId'])
  },
  record_agent_notes: {
    description: 'Persist structured assistant notes for the active session.',
    argsHint: '`note`; optional `batchId`, `localeVariantId`, `familyId`, `pbiIds`, `metadata`, `rationale`.',
    inputSchema: omitObjectSchemaProperties(MCP_RECORD_AGENT_NOTES_INPUT_SCHEMA, ['workspaceId'])
  },
  create_proposals: {
    description: 'Persist one or more structured proposal records in a worker pass.',
    argsHint: '`proposals` array with at least one item.',
    usageHint: 'Use only in direct worker stages after the plan is specific enough to persist approved create, edit, or retire work.',
    inputSchema: DIRECT_CREATE_PROPOSALS_INPUT_SCHEMA
  },
  patch_form: {
    description: 'Apply a validated patch to the current live working-state form.',
    argsHint: '`patch`; optional `versionToken`.',
    usageHint: 'Use only on routes that explicitly allow confirmed live form edits.',
    inputSchema: pickObjectSchemaProperties(MCP_APP_PATCH_FORM_INPUT_SCHEMA, ['versionToken', 'patch'], ['patch'])
  }
};

export function validateDirectActionArgs(actionType: DirectActionType, args: unknown): string | null {
  const definition = DIRECT_ACTION_DEFINITIONS[actionType];
  if (!definition) {
    return `Unknown direct action type ${actionType}`;
  }
  const validation = validateSchema(args, definition.inputSchema);
  return validation.valid ? null : `Invalid args for direct action ${actionType}: ${validation.error}`;
}
