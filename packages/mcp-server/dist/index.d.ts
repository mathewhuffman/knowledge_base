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
export declare class McpToolServer {
    private readonly tools;
    registerTool(name: string, description: string, handler: McpToolHandler, inputSchema?: unknown): void;
    unregisterTool(name: string): boolean;
    toolCount(): number;
    listTools(): McpToolDescriptor[];
    callTool(toolName: string, input: unknown, meta?: McpToolCallMeta): Promise<McpToolCallResult>;
    handleJsonMessage(raw: string | Record<string, unknown>): Promise<string | null>;
}
export {};
