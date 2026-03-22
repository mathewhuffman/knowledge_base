import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { CliHealthFailure, type KbAccessHealth } from '@kb-vault/shared-types';
import { WorkspaceRepository } from './workspace-repository';
import { KbCliLoopbackService } from './kb-cli-loopback-service';
import { logger } from './logger';

const KB_CLI_BINARY_ENV = 'KBV_KB_CLI_BINARY';

function resolveBinaryOnPath(binary: string): string | null {
  if (!binary) {
    return null;
  }

  if (path.isAbsolute(binary)) {
    return fs.existsSync(binary) ? binary : null;
  }

  const searchPath = process.env.PATH ?? '';
  for (const dir of searchPath.split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = path.join(dir, binary);
    const candidateWithExt = path.extname(candidate) ? candidate : `${candidate}.exe`;
    if (process.platform === 'win32') {
      if (fs.existsSync(candidateWithExt) || fs.existsSync(candidate)) {
        return fs.existsSync(candidateWithExt) ? candidateWithExt : candidate;
      }
      continue;
    }
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isBinaryExecutable(binaryPath: string): boolean {
  if (process.platform === 'win32') {
    return true;
  }
  try {
    fs.accessSync(binaryPath, fs.constants.X_OK);
    return true;
  } catch {
  return false;
}
}

type LoopbackContractProbe = {
  ok: boolean;
  message?: string;
  failureCode: CliHealthFailure;
};

export class KbCliRuntimeService {
  constructor(
    private readonly loopbackService: KbCliLoopbackService,
    private readonly workspaceRepository?: WorkspaceRepository
  ) {}

  getBinaryName(): string {
    return process.env[KB_CLI_BINARY_ENV]?.trim() || 'kb';
  }

  resolveBinaryPath(): string | null {
    return resolveBinaryOnPath(this.getBinaryName());
  }

  getEnvironment(): Record<string, string> {
    const baseUrl = this.loopbackService.getBaseUrl() ?? '';
    const authToken = this.loopbackService.getAuthToken();
    return {
      KB_AGENT_API_BASE_URL: baseUrl,
      KB_AGENT_API_TOKEN: authToken,
      KBV_KB_CLI_BASE_URL: baseUrl,
      KBV_KB_BASE_URL: baseUrl,
      KBV_KB_API_BASE_URL: baseUrl,
      KBV_KB_CLI_AUTH_TOKEN: authToken,
      KBV_KB_TOKEN: authToken,
      KBV_KB_API_TOKEN: authToken
    };
  }

  applyProcessEnv(): void {
    const env = this.getEnvironment();
    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value;
    }
  }

  buildPromptSuffix(): string {
    return [
      'CLI transport is preconfigured by KB Vault.',
      'Use plain `kb ... --json` commands first; do not invent localhost URLs or auth tokens.',
      'If syntax is unclear, call `kb --help` before trying a resource command.'
    ].join('\n');
  }

  async checkHealth(workspaceId?: string): Promise<KbAccessHealth> {
    const issues: string[] = [];
    let failureCode: CliHealthFailure | undefined;
    const binaryName = this.getBinaryName();
    const binaryPath = this.resolveBinaryPath();
    const baseUrl = this.loopbackService.getBaseUrl() ?? undefined;
    const authToken = this.loopbackService.getAuthToken();

    logger.info('kb-cli-runtime.checkHealth start', {
      workspaceId,
      binaryName,
      binaryPath,
      baseUrl,
      hasAuthToken: Boolean(authToken)
    });

    if (!binaryPath) {
      failureCode = CliHealthFailure.BINARY_NOT_FOUND;
      issues.push('KB CLI binary not found');
    } else if (!isBinaryExecutable(binaryPath)) {
      failureCode = CliHealthFailure.BINARY_NOT_EXECUTABLE;
      issues.push('KB CLI binary is not executable');
    }

    if (!authToken) {
      failureCode = failureCode ?? CliHealthFailure.AUTH_TOKEN_MISSING;
      issues.push('Loopback auth token is empty');
    }

    let loopbackReady = false;
    if (!baseUrl) {
      failureCode = failureCode ?? CliHealthFailure.LOOPBACK_NOT_RUNNING;
      issues.push('Local KB CLI API is not running');
    } else {
      const loopbackResult = await this.checkLoopbackHealth(baseUrl);
      logger.info('kb-cli-runtime.checkHealth loopback', {
        workspaceId,
        baseUrl,
        healthy: loopbackResult.healthy,
        failureCode: loopbackResult.failureCode,
        message: loopbackResult.message || undefined
      });
      loopbackReady = loopbackResult.healthy;
      if (!loopbackReady) {
        failureCode = failureCode ?? loopbackResult.failureCode;
        issues.push(loopbackResult.message);
      }
    }

    let probeOk = false;
    let contractProbeMessage: string | undefined;
    let contractFailureCode: CliHealthFailure | undefined;
    let probeMessage: string | undefined;
    let probeFailureCode: CliHealthFailure | undefined;
    if (binaryPath && isBinaryExecutable(binaryPath) && loopbackReady) {
      const probe = await this.runHealthProbe(binaryPath);
      logger.info('kb-cli-runtime.checkHealth cli_probe', {
        workspaceId,
        binaryPath,
        ok: probe.ok,
        failureCode: probe.failureCode,
        message: probe.message
      });
      probeOk = probe.ok;
      probeMessage = probe.message;
      probeFailureCode = probe.failureCode;
      if (!probe.ok) {
        failureCode = failureCode ?? probe.failureCode;
        issues.push(probe.message ?? 'kb health --json failed');
      } else if (baseUrl) {
        try {
          const contractProbe = await this.runLoopbackContractProbe(baseUrl, workspaceId);
          logger.info('kb-cli-runtime.checkHealth contract_probe', {
            workspaceId,
            baseUrl,
            ok: contractProbe.ok,
            failureCode: contractProbe.failureCode,
            message: contractProbe.message
          });
          if (!contractProbe.ok) {
            probeOk = false;
            contractProbeMessage = contractProbe.message;
            contractFailureCode = contractProbe.failureCode;
            failureCode = failureCode ?? contractFailureCode;
            if (contractProbe.message) {
              issues.push(contractProbe.message);
            }
          }
        } catch (error) {
          probeOk = false;
          contractProbeMessage = error instanceof Error ? error.message : String(error);
          contractFailureCode = CliHealthFailure.HEALTH_PROBE_REJECTED;
          failureCode = failureCode ?? contractFailureCode;
          issues.push(contractProbeMessage);
          logger.error('kb-cli-runtime.checkHealth contract_probe_failed', {
            workspaceId,
            baseUrl,
            message: contractProbeMessage,
            stack: error instanceof Error ? error.stack : undefined
          });
        }
      }
    }

    const ok = Boolean(binaryPath) && isBinaryExecutable(binaryPath ?? '') && loopbackReady && probeOk;
    const result: KbAccessHealth = {
      mode: 'cli',
      provider: 'cli',
      ok,
      binaryPath: binaryPath ?? undefined,
      baseUrl,
      message: ok
        ? 'CLI access ready'
        : contractProbeMessage ?? probeMessage ?? issues[0] ?? 'CLI access unavailable',
      issues,
      failureCode: ok ? undefined : failureCode ?? contractFailureCode ?? probeFailureCode
    };
    logger.info('kb-cli-runtime.checkHealth result', {
      workspaceId,
      ok: result.ok,
      binaryPath: result.binaryPath,
      baseUrl: result.baseUrl,
      failureCode: result.failureCode,
      message: result.message,
      issues: result.issues
    });
    return result;
  }

  private async runLoopbackContractProbe(baseUrl: string, workspaceId?: string): Promise<LoopbackContractProbe> {
    if (!this.workspaceRepository) {
      return {
        ok: true,
        failureCode: CliHealthFailure.HEALTH_PROBE_REJECTED
      };
    }

    const workspace = workspaceId
      ? await this.workspaceRepository.getWorkspace(workspaceId)
      : (await this.workspaceRepository.listWorkspaces())[0];
    if (workspaceId && !workspace) {
      return {
        ok: false,
        message: `Workspace ${workspaceId} not found for loopback contract probe`,
        failureCode: CliHealthFailure.HEALTH_PROBE_REJECTED
      };
    }
    if (!workspace) {
      return {
        ok: true,
        failureCode: CliHealthFailure.HEALTH_PROBE_REJECTED
      };
    }

    const families = await this.workspaceRepository.listArticleFamilies(workspace.id);
    if (!families.length) {
      return {
        ok: true,
        failureCode: CliHealthFailure.HEALTH_PROBE_REJECTED
      };
    }

    const family = families[0];
    const variants = await this.workspaceRepository.getLocaleVariantsForFamily(workspace.id, family.id);
    if (!variants.length) {
      return {
        ok: true,
        failureCode: CliHealthFailure.HEALTH_PROBE_REJECTED
      };
    }

    const variant = variants[0];

    const articlePayload = await this.fetchLoopbackJson(
      `${baseUrl}/workspaces/${encodeURIComponent(workspace.id)}/articles/variants/${encodeURIComponent(variant.id)}`,
      { method: 'GET' }
    );
    if (typeof articlePayload !== 'object' || articlePayload === null || (articlePayload as { ok?: boolean }).ok !== true) {
      return {
        ok: false,
        message: `Loopback article contract invalid for workspace ${workspace.id}`,
        failureCode: CliHealthFailure.HEALTH_PROBE_REJECTED
      };
    }

    const articlePayloadRecord = articlePayload as Record<string, unknown>;
    if (!articlePayloadRecord.article || typeof articlePayloadRecord.article !== 'object') {
      return {
        ok: false,
        message: 'Loopback get-article contract missing article envelope',
        failureCode: CliHealthFailure.HEALTH_PROBE_REJECTED
      };
    }

    const familyPayload = await this.fetchLoopbackJson(
      `${baseUrl}/workspaces/${encodeURIComponent(workspace.id)}/articles/families/${encodeURIComponent(family.id)}`,
      { method: 'GET' }
    );
    if (typeof familyPayload !== 'object' || familyPayload === null || (familyPayload as { ok?: boolean }).ok !== true) {
      return {
        ok: false,
        message: `Loopback article-family contract invalid for workspace ${workspace.id}`,
        failureCode: CliHealthFailure.HEALTH_PROBE_REJECTED
      };
    }

    const familyPayloadRecord = familyPayload as Record<string, unknown>;
    if (!familyPayloadRecord.family || !Array.isArray(familyPayloadRecord.variants) || !Array.isArray(familyPayloadRecord.revisions)) {
      return {
        ok: false,
        message: 'Loopback get-article-family contract missing family, variants, or revisions',
        failureCode: CliHealthFailure.HEALTH_PROBE_REJECTED
      };
    }

    const relatedPayload = await this.fetchLoopbackJson(
      `${baseUrl}/workspaces/${encodeURIComponent(workspace.id)}/articles/related`,
      {
        method: 'POST',
        body: JSON.stringify({ articleId: variant.id, limit: 5 }),
        headers: { 'content-type': 'application/json' }
      }
    );
    if (typeof relatedPayload !== 'object' || relatedPayload === null || (relatedPayload as { ok?: boolean }).ok !== true) {
      return {
        ok: false,
        message: `Loopback find-related-articles contract invalid for workspace ${workspace.id}`,
        failureCode: CliHealthFailure.HEALTH_PROBE_REJECTED
      };
    }

    const relatedPayloadRecord = relatedPayload as Record<string, unknown>;
    const total = relatedPayloadRecord.total;
    if (
      typeof total !== 'number' ||
      !Number.isInteger(total) ||
      total < 0 ||
      !Array.isArray(relatedPayloadRecord.results)
    ) {
      return {
        ok: false,
        message: 'Loopback find-related-articles contract missing total/results',
        failureCode: CliHealthFailure.HEALTH_PROBE_REJECTED
      };
    }

    return {
      ok: true,
      failureCode: CliHealthFailure.HEALTH_PROBE_REJECTED
    };
  }

  private async fetchLoopbackJson(url: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(url, {
      ...init,
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${this.loopbackService.getAuthToken()}`,
        ...(init.headers ?? {})
      }
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Loopback contract probe returned HTTP ${response.status}: ${text}`);
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Loopback contract probe response was not valid JSON');
    }
  }

  private async checkLoopbackHealth(baseUrl: string): Promise<{
    healthy: boolean;
    failureCode: CliHealthFailure;
    message: string;
  }> {
    try {
      const response = await fetch(`${baseUrl}/health?token=${encodeURIComponent(this.loopbackService.getAuthToken())}`);
      if (!response.ok) {
        return {
          healthy: false,
          failureCode: CliHealthFailure.LOOPBACK_UNHEALTHY,
          message: `Local KB CLI API returned HTTP ${response.status}`
        };
      }
      const json = await response.json() as { ok?: boolean };
      if (json.ok !== true) {
        return {
          healthy: false,
          failureCode: CliHealthFailure.LOOPBACK_UNHEALTHY,
          message: 'Local KB CLI API /health returned ok=false'
        };
      }
      return {
        healthy: true,
        failureCode: CliHealthFailure.LOOPBACK_UNHEALTHY,
        message: ''
      };
    } catch {
      return {
        healthy: false,
        failureCode: CliHealthFailure.LOOPBACK_UNREACHABLE,
        message: 'Local KB CLI API did not respond to /health'
      };
    }
  }

  private async runHealthProbe(binaryPath: string): Promise<{
    ok: boolean;
    message?: string;
    failureCode?: CliHealthFailure;
  }> {
    return new Promise((resolve) => {
      const child = spawn(binaryPath, ['health', '--json'], {
        env: {
          ...process.env,
          ...this.getEnvironment()
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const timeout = setTimeout(() => {
        child.kill();
        resolve({
          ok: false,
          message: 'kb health --json timed out',
          failureCode: CliHealthFailure.HEALTH_PROBE_TIMEOUT
        });
      }, 5_000);

      child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', (error) => {
        clearTimeout(timeout);
        resolve({
          ok: false,
          message: error.message,
          failureCode: CliHealthFailure.HEALTH_PROBE_FAILED
        });
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        const stdoutText = Buffer.concat(stdout).toString('utf8').trim();
        const stderrText = Buffer.concat(stderr).toString('utf8').trim();
        if (code !== 0) {
          resolve({
            ok: false,
            message: stderrText || stdoutText || `kb health --json exited with code ${code}`,
            failureCode: CliHealthFailure.HEALTH_PROBE_FAILED
          });
          return;
        }

        if (!stdoutText) {
          resolve({ ok: true, message: 'kb health --json completed' });
          return;
        }

        try {
          const parsed = JSON.parse(stdoutText) as { ok?: boolean; message?: string; status?: string };
          if (parsed.ok === false) {
            resolve({
              ok: false,
              message: parsed.message || parsed.status || 'kb health --json reported failure',
              failureCode: CliHealthFailure.HEALTH_PROBE_REJECTED
            });
            return;
          }
          resolve({ ok: true, message: parsed.message || parsed.status || 'kb health --json completed' });
        } catch {
          resolve({ ok: true, message: stdoutText });
        }
      });
    });
  }
}
