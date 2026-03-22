"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpToolServer = void 0;
class McpToolServer {
    tools = new Map();
    registerTool(name, description, handler, inputSchema) {
        this.tools.set(name, {
            descriptor: {
                name,
                description,
                inputSchema
            },
            handler
        });
    }
    unregisterTool(name) {
        return this.tools.delete(name);
    }
    toolCount() {
        return this.tools.size;
    }
    listTools() {
        return Array.from(this.tools.values()).map((entry) => entry.descriptor);
    }
    async callTool(toolName, input, meta) {
        const tool = this.tools.get(toolName);
        if (!tool) {
            return { ok: false, error: `Unknown MCP tool: ${toolName}` };
        }
        try {
            const data = await tool.handler(input, meta);
            return { ok: true, data };
        }
        catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    }
    async handleJsonMessage(raw) {
        let parsed;
        try {
            parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        }
        catch {
            return JSON.stringify({
                jsonrpc: '2.0',
                id: randomId(),
                error: {
                    code: -32700,
                    message: 'Parse error'
                }
            });
        }
        const envelope = parsed;
        if (envelope?.jsonrpc !== '2.0' || !envelope.method) {
            return JSON.stringify({
                jsonrpc: '2.0',
                id: randomId(),
                error: {
                    code: -32600,
                    message: 'Invalid JSON-RPC message'
                }
            });
        }
        if (envelope.method === 'tools/list') {
            const response = {
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
            const response = {
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
        });
    }
}
exports.McpToolServer = McpToolServer;
const randomId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
