import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { CursorAcpRuntime } from '@kb-vault/agent-runtime';
import { logger } from './logger';

function resolveSocketPath(appName: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\${appName}-mcp-bridge`;
  }

  return path.join(os.tmpdir(), `${appName}-mcp-bridge.sock`);
}

export class McpBridgeService {
  private server: net.Server | null = null;
  private readonly socketPath: string;

  constructor(private readonly runtime: CursorAcpRuntime, appName = 'kb-vault') {
    this.socketPath = resolveSocketPath(appName);
  }

  getSocketPath(): string {
    return this.socketPath;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }

    this.server = net.createServer((socket) => {
      let buffer = '';

      socket.on('data', async (chunk: Buffer | string) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines.map((entry) => entry.trim()).filter(Boolean)) {
          try {
            const response = await this.runtime.handleMcpJsonMessage(line);
            if (response) {
              socket.write(`${response}\n`);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error('mcp-bridge request failed', { message });
            socket.write(
              `${JSON.stringify({
                jsonrpc: '2.0',
                id: `${Date.now()}`,
                error: {
                  code: -32603,
                  message
                }
              })}\n`
            );
          }
        }
      });

      socket.on('error', (error) => {
        logger.error('mcp-bridge socket error', {
          message: error.message,
          stack: error.stack
        });
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.socketPath, () => {
        this.server?.off('error', reject);
        logger.info('mcp-bridge listening', { socketPath: this.socketPath });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = null;

    if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }
  }
}
