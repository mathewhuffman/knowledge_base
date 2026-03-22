export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema?: unknown;
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
  id?: string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcToolListResponse {
  jsonrpc: '2.0';
  id: string;
  result: {
    tools: McpToolDescriptor[];
  };
}

interface JsonRpcErrorResponse {
  code: number;
  message: string;
}

interface JsonRpcToolCallResponse {
  jsonrpc: '2.0';
  id: string;
  result?: McpToolCallResult;
  error?: JsonRpcErrorResponse;
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
    return Array.from(this.tools.values()).map((entry) => entry.descriptor);
  }

  async callTool(toolName: string, input: unknown, meta?: McpToolCallMeta): Promise<McpToolCallResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { ok: false, error: `Unknown MCP tool: ${toolName}` };
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
        id: randomId(),
        error: {
          code: -32700,
          message: 'Parse error'
        }
      } satisfies JsonRpcToolCallResponse);
    }

    const envelope = parsed as JsonRpcEnvelope;
    if (envelope?.jsonrpc !== '2.0' || !envelope.method) {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: randomId(),
        error: {
          code: -32600,
          message: 'Invalid JSON-RPC message'
        }
      } satisfies JsonRpcToolCallResponse);
    }

    if (envelope.method === 'tools/list') {
      const response: JsonRpcToolListResponse = {
        jsonrpc: '2.0',
        id: envelope.id ?? randomId(),
        result: {
          tools: this.listTools()
        }
      };
      return JSON.stringify(response);
    }

    if (envelope.method === 'tools/call') {
      const toolName = String((envelope.params ?? {}).name ?? '');
      const toolInput = (envelope.params ?? {}).arguments ?? (envelope.params ?? {});
      const callId = String(envelope.id ?? randomId());
      const result = await this.callTool(toolName, toolInput, { requestId: callId });
      const response: JsonRpcToolCallResponse = {
        jsonrpc: '2.0',
        id: callId,
        result
      };
      return JSON.stringify(response);
    }

    return JSON.stringify({
      jsonrpc: '2.0',
      id: String(envelope.id ?? randomId()),
      error: {
        code: -32601,
        message: `Unsupported MCP method: ${envelope.method}`
      }
    } satisfies JsonRpcToolCallResponse);
  }
}

const randomId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
