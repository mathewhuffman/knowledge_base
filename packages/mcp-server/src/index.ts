export interface McpToolDescriptor {
  name: string;
  title?: string;
  description: string;
  inputSchema?: unknown;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface McpToolCallMeta {
  requestId?: string;
}

export interface McpToolCallResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

type McpToolHandler = (input: unknown, meta?: McpToolCallMeta) => Promise<unknown>;

interface RegisteredTool {
  descriptor: McpToolDescriptor;
  handler: McpToolHandler;
}

interface JsonRpcEnvelope {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: string | number;
  result: Record<string, unknown>;
}

interface JsonRpcErrorResponse {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcErrorEnvelope {
  jsonrpc: '2.0';
  id: string | number | null;
  error?: JsonRpcErrorResponse;
}

interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  minProperties?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

const MCP_SERVER_INFO = {
  name: 'kb-vault-mcp',
  title: 'KB Vault MCP Bridge',
  version: '0.1.0'
} as const;

const DEFAULT_MCP_PROTOCOL_VERSION = '2025-06-18';

const MCP_SERVER_INSTRUCTIONS =
  'Use the direct KB Vault tools exposed by this server. Discover them with tools/list and invoke them with tools/call.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toJsonRpcId(value: string | number | undefined): string | number {
  return value ?? randomId();
}

function resolveProtocolVersion(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_MCP_PROTOCOL_VERSION;
}

function serializeToolContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return 'null';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeToolInputSchema(schema: unknown): JsonSchema {
  if (isRecord(schema) && schema.type === 'object') {
    return schema as JsonSchema;
  }

  return {
    type: 'object',
    properties: {},
    additionalProperties: true
  };
}

function humanizeToolName(name: string): string {
  return name
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function inferToolAnnotations(name: string): McpToolDescriptor['annotations'] {
  const readOnly = /^(get|find|search|list)_/.test(name);
  return readOnly
    ? {
        title: humanizeToolName(name),
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    : {
        title: humanizeToolName(name),
        destructiveHint: false,
        openWorldHint: false
      };
}

function buildInitializeResult(protocolVersion: string): Record<string, unknown> {
  return {
    protocolVersion,
    capabilities: {
      tools: {
        listChanged: false
      }
    },
    serverInfo: MCP_SERVER_INFO,
    instructions: MCP_SERVER_INSTRUCTIONS
  };
}

function buildToolListResult(tools: McpToolDescriptor[]): Record<string, unknown> {
  return {
    tools
  };
}

function buildToolCallResult(result: McpToolCallResult): Record<string, unknown> {
  if (result.ok) {
    return {
      content: [
        {
          type: 'text',
          text: serializeToolContent(result.data ?? null)
        }
      ],
      structuredContent: {
        ok: true,
        data: result.data ?? null
      },
      ok: true,
      data: result.data ?? null
    };
  }

  const errorMessage = result.error ?? 'Tool call failed';
  return {
    content: [
      {
        type: 'text',
        text: errorMessage
      }
    ],
    structuredContent: {
      ok: false,
      error: errorMessage
    },
    isError: true,
    ok: false,
    error: errorMessage
  };
}

function formatSchemaPath(path: string): string {
  return path === 'input' ? 'input' : path.replace(/^input\./, '');
}

function validateSchema(value: unknown, schema: unknown, path = 'input'): ValidationResult {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { valid: true };
  }

  const normalized = schema as JsonSchema;
  const typeList = Array.isArray(normalized.type)
    ? normalized.type
    : normalized.type
      ? [normalized.type]
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

  if (Array.isArray(normalized.enum) && normalized.enum.length > 0) {
    const matched = normalized.enum.some((candidate) => candidate === value);
    if (!matched) {
      return {
        valid: false,
        error: `${formatSchemaPath(path)} must be one of: ${normalized.enum.map(String).join(', ')}`
      };
    }
  }

  if (typeof normalized.minLength === 'number' && typeof value === 'string' && value.length < normalized.minLength) {
    return {
      valid: false,
      error: `${formatSchemaPath(path)} must be at least ${normalized.minLength} characters`
    };
  }

  if (typeof normalized.maxLength === 'number' && typeof value === 'string' && value.length > normalized.maxLength) {
    return {
      valid: false,
      error: `${formatSchemaPath(path)} must be at most ${normalized.maxLength} characters`
    };
  }

  if (typeof normalized.minimum === 'number' && typeof value === 'number' && value < normalized.minimum) {
    return {
      valid: false,
      error: `${formatSchemaPath(path)} must be >= ${normalized.minimum}`
    };
  }

  if (typeof normalized.maximum === 'number' && typeof value === 'number' && value > normalized.maximum) {
    return {
      valid: false,
      error: `${formatSchemaPath(path)} must be <= ${normalized.maximum}`
    };
  }

  if (Array.isArray(value)) {
    if (typeof normalized.minItems === 'number' && value.length < normalized.minItems) {
      return {
        valid: false,
        error: `${formatSchemaPath(path)} must contain at least ${normalized.minItems} item(s)`
      };
    }
    if (normalized.items) {
      for (let index = 0; index < value.length; index += 1) {
        const nested = validateSchema(value[index], normalized.items, `${path}[${index}]`);
        if (!nested.valid) {
          return nested;
        }
      }
    }
  }

  if (isRecord(value)) {
    if (typeof normalized.minProperties === 'number' && Object.keys(value).length < normalized.minProperties) {
      return {
        valid: false,
        error: `${formatSchemaPath(path)} must include at least ${normalized.minProperties} field(s)`
      };
    }

    const properties = normalized.properties ?? {};
    for (const requiredKey of normalized.required ?? []) {
      if (!(requiredKey in value)) {
        return {
          valid: false,
          error: `${formatSchemaPath(path === 'input' ? `input.${requiredKey}` : `${path}.${requiredKey}`)} is required`
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

    if (normalized.additionalProperties === false) {
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

  if (Array.isArray(normalized.anyOf) && normalized.anyOf.length > 0) {
    const anyValid = normalized.anyOf.some((candidate) => validateSchema(value, candidate, path).valid);
    if (!anyValid) {
      return {
        valid: false,
        error: `${formatSchemaPath(path)} must satisfy at least one allowed input shape`
      };
    }
  }

  if (Array.isArray(normalized.oneOf) && normalized.oneOf.length > 0) {
    const matchingSchemas = normalized.oneOf.filter((candidate) => validateSchema(value, candidate, path).valid);
    if (matchingSchemas.length !== 1) {
      return {
        valid: false,
        error: `${formatSchemaPath(path)} must satisfy exactly one allowed input shape`
      };
    }
  }

  return { valid: true };
}

export class McpToolServer {
  private readonly tools = new Map<string, RegisteredTool>();

  registerTool(name: string, description: string, handler: McpToolHandler, inputSchema?: unknown): void {
    this.tools.set(name, {
      descriptor: {
        name,
        description,
        inputSchema
      },
      handler
    });
  }

  unregisterTool(name: string): boolean {
    return this.tools.delete(name);
  }

  toolCount(): number {
    return this.tools.size;
  }

  listTools(): McpToolDescriptor[] {
    return Array.from(this.tools.values()).map((entry) => ({
      ...entry.descriptor,
      title: entry.descriptor.title ?? humanizeToolName(entry.descriptor.name),
      inputSchema: normalizeToolInputSchema(entry.descriptor.inputSchema),
      annotations: entry.descriptor.annotations ?? inferToolAnnotations(entry.descriptor.name)
    }));
  }

  async callTool(toolName: string, input: unknown, meta?: McpToolCallMeta): Promise<McpToolCallResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { ok: false, error: `Unknown MCP tool: ${toolName}` };
    }

    const validation = validateSchema(input, tool.descriptor.inputSchema);
    if (!validation.valid) {
      return { ok: false, error: `Invalid input for MCP tool ${toolName}: ${validation.error}` };
    }

    try {
      const data = await tool.handler(input, meta);
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async handleJsonMessage(raw: string | Record<string, unknown>): Promise<string | null> {
    let parsed: JsonRpcEnvelope;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error'
        }
      } satisfies JsonRpcErrorEnvelope);
    }

    const envelope = parsed as JsonRpcEnvelope;
    if (envelope?.jsonrpc !== '2.0' || !envelope.method) {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: toJsonRpcId(envelope?.id),
        error: {
          code: -32600,
          message: 'Invalid JSON-RPC message'
        }
      } satisfies JsonRpcErrorEnvelope);
    }

    if (envelope.method === 'initialize') {
      const response: JsonRpcSuccessResponse = {
        jsonrpc: '2.0',
        id: toJsonRpcId(envelope.id),
        result: buildInitializeResult(resolveProtocolVersion(envelope.params?.protocolVersion))
      };
      return JSON.stringify(response);
    }

    if (envelope.method === 'notifications/initialized' || envelope.method === 'initialized') {
      return null;
    }

    if (envelope.method === 'tools/list') {
      const response: JsonRpcSuccessResponse = {
        jsonrpc: '2.0',
        id: toJsonRpcId(envelope.id),
        result: buildToolListResult(this.listTools())
      };
      return JSON.stringify(response);
    }

    if (envelope.method === 'tools/call') {
      const toolName = String((envelope.params ?? {}).name ?? '');
      const toolInput = (envelope.params ?? {}).arguments ?? (envelope.params ?? {});
      const callId = toJsonRpcId(envelope.id);
      const result = await this.callTool(toolName, toolInput, { requestId: String(callId) });
      const response: JsonRpcSuccessResponse = {
        jsonrpc: '2.0',
        id: callId,
        result: buildToolCallResult(result)
      };
      return JSON.stringify(response);
    }

    if (envelope.id === undefined && envelope.method.startsWith('notifications/')) {
      return null;
    }

    return JSON.stringify({
      jsonrpc: '2.0',
      id: toJsonRpcId(envelope.id),
      error: {
        code: -32601,
        message: `Unsupported MCP method: ${envelope.method}`
      }
    } satisfies JsonRpcErrorEnvelope);
  }
}

const randomId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
