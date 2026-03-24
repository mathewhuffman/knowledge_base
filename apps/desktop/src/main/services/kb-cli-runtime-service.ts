import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { CliHealthFailure, type KbAccessHealth } from '@kb-vault/shared-types';
import { WorkspaceRepository } from './workspace-repository';
import { KbCliLoopbackService } from './kb-cli-loopback-service';
import { logger } from './logger';

const KB_CLI_SHIM_DIR = path.join(os.tmpdir(), 'kb-vault-cli-shim');

function buildKbCliShimSource(): string {
  const createProposalExample = JSON.stringify(
    `kb proposal create --workspace-id <workspaceId> --batch-id <batchId> --session-id <sessionId> --note "Create Duplicate Food Lists and Food Items (Portal)" --rationale "No duplicate-specific article exists; create one for the portal duplicate flow." --pbi-ids 102,103 --metadata '{"targetTitle":"Duplicate Food Lists and Food Items (Portal)","proposedHtml":"<h1>Duplicate Food Lists and Food Items (Portal)</h1><p>...</p>"}' --json`
  );
  const editProposalExample = JSON.stringify(
    `kb proposal edit --workspace-id <workspaceId> --batch-id <batchId> --session-id <sessionId> --locale-variant-id <localeVariantId> --note "Edit Create a Food List" --rationale "Add the new management flow." --pbi-ids 101 --metadata '{"targetTitle":"Create a Food List","proposedHtml":"<h1>Create a Food List</h1><p>...</p>"}' --json`
  );
  const editProposalFileExample = JSON.stringify(
    `kb proposal edit --workspace-id <workspaceId> --batch-id <batchId> --session-id <sessionId> --locale-variant-id <localeVariantId> --note "Edit Create a Food List" --rationale "Add the new management flow." --pbi-ids 101 --metadata-file /tmp/create-food-list-metadata.json --json`
  );
  const getFormSchemaExample = JSON.stringify(
    `kb app get-form-schema --workspace-id <workspaceId> --route templates_and_prompts --entity-type template_pack --entity-id <templatePackId> --json`
  );
  const patchFormExample = JSON.stringify(
    `kb app patch-form --workspace-id <workspaceId> --route templates_and_prompts --entity-type template_pack --entity-id <templatePackId> --version-token <versionToken> --patch '{"promptTemplate":"hello world"}' --json`
  );
  const patchFormFileExample = JSON.stringify(
    `kb app patch-form --workspace-id <workspaceId> --route templates_and_prompts --entity-type template_pack --entity-id <templatePackId> --patch-file /tmp/template-patch.json --json`
  );
  return `#!/usr/bin/env node
'use strict';

const process = require('node:process');
const fs = require('node:fs');
const { URLSearchParams } = require('node:url');

function normalizeKey(key) {
  return String(key || '')
    .replace(/^--/, '')
    .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function parseArgv(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const key = normalizeKey(token);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }
    index += 1;
    const existing = options[key];
    if (existing === undefined) {
      options[key] = next;
      continue;
    }
    options[key] = Array.isArray(existing) ? [...existing, next] : [existing, next];
  }
  return { positionals, options };
}

function write(payload, jsonMode) {
  if (jsonMode || typeof payload === 'object') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\\n');
    return;
  }
  process.stdout.write(String(payload) + '\\n');
}

function fail(command, message, code, jsonMode) {
  const payload = { ok: false, command, error: { code: code || 'VALIDATION_ERROR', message } };
  write(payload, jsonMode);
  process.exit(1);
}

function requireOption(options, key, command, jsonMode) {
  const value = options[key];
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  fail(command, '--' + key.replace(/[A-Z]/g, (char) => '-' + char.toLowerCase()) + ' is required', 'VALIDATION_ERROR', jsonMode);
}

function getString(options, ...keys) {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function getCsvList(options, ...keys) {
  for (const key of keys) {
    const value = options[key];
    if (Array.isArray(value)) {
      return value.flatMap((item) => String(item).split(',')).map((item) => item.trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function getJsonMetadata(options, command, jsonMode) {
  const metadata = getString(options, 'metadata');
  const metadataFile = getString(options, 'metadataFile');

  if (metadata && metadataFile) {
    fail(command, 'Use only one of --metadata or --metadata-file', 'VALIDATION_ERROR', jsonMode);
  }

  if (metadataFile) {
    try {
      const raw = fs.readFileSync(metadataFile, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      fail(
        command,
        error instanceof Error ? 'Unable to read --metadata-file: ' + error.message : 'Unable to read --metadata-file',
        'VALIDATION_ERROR',
        jsonMode
      );
    }
  }

  if (metadata) {
    try {
      return JSON.parse(metadata);
    } catch (error) {
      fail(
        command,
        error instanceof Error ? 'Unable to parse --metadata: ' + error.message : 'Unable to parse --metadata',
        'VALIDATION_ERROR',
        jsonMode
      );
    }
  }

  return undefined;
}

function getJsonObjectOption(options, directKey, fileKey, command, jsonMode) {
  const directValue = getString(options, directKey);
  const fileValue = getString(options, fileKey);

  if (directValue && fileValue) {
    fail(command, 'Use only one of --' + directKey.replace(/[A-Z]/g, (char) => '-' + char.toLowerCase()) + ' or --' + fileKey.replace(/[A-Z]/g, (char) => '-' + char.toLowerCase()), 'VALIDATION_ERROR', jsonMode);
  }

  if (fileValue) {
    try {
      const raw = fs.readFileSync(fileValue, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        fail(command, '--' + fileKey.replace(/[A-Z]/g, (char) => '-' + char.toLowerCase()) + ' must contain a JSON object', 'VALIDATION_ERROR', jsonMode);
      }
      return parsed;
    } catch (error) {
      fail(
        command,
        error instanceof Error ? 'Unable to read --' + fileKey.replace(/[A-Z]/g, (char) => '-' + char.toLowerCase()) + ': ' + error.message : 'Unable to read JSON file option',
        'VALIDATION_ERROR',
        jsonMode
      );
    }
  }

  if (directValue) {
    try {
      const parsed = JSON.parse(directValue);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        fail(command, '--' + directKey.replace(/[A-Z]/g, (char) => '-' + char.toLowerCase()) + ' must be a JSON object', 'VALIDATION_ERROR', jsonMode);
      }
      return parsed;
    } catch (error) {
      fail(
        command,
        error instanceof Error ? 'Unable to parse --' + directKey.replace(/[A-Z]/g, (char) => '-' + char.toLowerCase()) + ': ' + error.message : 'Unable to parse JSON option',
        'VALIDATION_ERROR',
        jsonMode
      );
    }
  }

  return undefined;
}

function getBaseUrl() {
  return process.env.KB_AGENT_API_BASE_URL
    || process.env.KBV_KB_CLI_BASE_URL
    || process.env.KBV_KB_BASE_URL
    || process.env.KBV_KB_API_BASE_URL
    || '';
}

function getAuthToken() {
  return process.env.KBV_KB_CLI_AUTH_TOKEN
    || process.env.KBV_KB_TOKEN
    || process.env.KBV_KB_API_TOKEN
    || '';
}

async function requestJson(method, pathname, query, body) {
  const baseUrl = getBaseUrl();
  const authToken = getAuthToken();
  if (!baseUrl) {
    throw new Error('KB CLI base URL is not configured');
  }
  if (!authToken) {
    throw new Error('KB CLI auth token is not configured');
  }

  const url = new URL(pathname, baseUrl);
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      params.set(key, String(value));
    }
    const search = params.toString();
    if (search) {
      url.search = search;
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      authorization: 'Bearer ' + authToken,
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let payload = null;
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('Loopback response was not valid JSON');
    }
  }

  if (!response.ok) {
    const message = payload && typeof payload.error === 'string'
      ? payload.error
      : 'HTTP ' + response.status;
    throw new Error(message);
  }

  return payload;
}

function buildRootHelp() {
  return {
    usage: 'kb <command> [options] --json',
    commands: [
      'health',
      'batch-context',
      'find-related-articles',
      'search-kb',
      'get-article',
      'get-article-manual',
      'get-article-family',
      'app get-form-schema',
      'app patch-form',
      'proposal create',
      'proposal edit',
      'proposal retire',
      'help'
    ]
  };
}

function buildAppHelp() {
  return {
    usage: 'kb app <get-form-schema|patch-form> --workspace-id <workspaceId> --route <route> --entity-type <entityType> --entity-id <entityId> [options] --json',
    subcommands: ['get-form-schema', 'patch-form'],
    options: [
      '--workspace-id',
      '--route',
      '--entity-type',
      '--entity-id',
      '--version-token',
      '--patch',
      '--patch-file'
    ],
    examples: [
      ${getFormSchemaExample},
      ${patchFormExample},
      ${patchFormFileExample}
    ]
  };
}

function buildProposalHelp() {
  return {
    usage: 'kb proposal <create|edit|retire> --workspace-id <workspaceId> --batch-id <batchId> [options] --json',
    subcommands: ['create', 'edit', 'retire'],
    options: [
      '--workspace-id',
      '--batch-id',
      '--session-id',
      '--locale-variant-id',
      '--note',
      '--rationale',
      '--pbi-ids',
      '--metadata',
      '--metadata-file'
    ],
    examples: [
      ${createProposalExample},
      ${editProposalExample},
      ${editProposalFileExample}
    ]
  };
}

function pickBestSearchResult(results, query) {
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }
  const normalized = String(query || '').trim().toLowerCase();
  return results.find((item) => String(item.title || '').trim().toLowerCase() === normalized)
    || results.find((item) => String(item.familyExternalKey || '').trim().toLowerCase() === normalized)
    || results[0];
}

async function resolveArticle(workspaceId, options, command, jsonMode) {
  const localeVariantId = getString(options, 'localeVariantId', 'articleId');
  if (localeVariantId) {
    return requestJson('GET', '/workspaces/' + encodeURIComponent(workspaceId) + '/articles/variants/' + encodeURIComponent(localeVariantId));
  }

  const familyId = getString(options, 'familyId', 'articleFamilyId');
  if (familyId) {
    const familyPayload = await requestJson('GET', '/workspaces/' + encodeURIComponent(workspaceId) + '/articles/families/' + encodeURIComponent(familyId));
    const firstVariantId = Array.isArray(familyPayload.variants) && familyPayload.variants[0] && familyPayload.variants[0].id;
    if (!firstVariantId) {
      fail(command, 'No locale variants found for article family', 'NOT_FOUND', jsonMode);
    }
    return requestJson('GET', '/workspaces/' + encodeURIComponent(workspaceId) + '/articles/variants/' + encodeURIComponent(firstVariantId));
  }

  const query = getString(options, 'query', 'title', 'q', 'externalKey', 'file');
  if (!query) {
    fail(command, 'Provide --locale-variant-id, --family-id, or --query', 'VALIDATION_ERROR', jsonMode);
  }

  const searchPayload = await requestJson(
    'GET',
    '/workspaces/' + encodeURIComponent(workspaceId) + '/articles/search',
    { query }
  );
  const chosen = pickBestSearchResult(searchPayload.results, query);
  if (!chosen || !chosen.localeVariantId) {
    fail(command, 'Article not found for query: ' + query, 'NOT_FOUND', jsonMode);
  }
  return requestJson(
    'GET',
    '/workspaces/' + encodeURIComponent(workspaceId) + '/articles/variants/' + encodeURIComponent(chosen.localeVariantId)
  );
}

(async () => {
  const argv = process.argv.slice(2);
  const { positionals, options } = parseArgv(argv);
  const jsonMode = options.json === true;
  const command = positionals[0] || 'help';
  const subcommand = positionals[1];

  if (command === 'help' || options.help === true || command === '--help') {
    if (positionals[0] === 'proposal' || subcommand === 'proposal') {
      write({ ok: true, command: 'help', data: buildProposalHelp() }, jsonMode);
      return;
    }
    if (positionals[0] === 'app' || subcommand === 'app') {
      write({ ok: true, command: 'help', data: buildAppHelp() }, jsonMode);
      return;
    }
    write({ ok: true, command: 'help', data: buildRootHelp() }, jsonMode);
    return;
  }

  if (command === 'proposal' && !subcommand) {
    write({ ok: true, command: 'help', data: buildProposalHelp() }, jsonMode);
    return;
  }

  if (command === 'app' && !subcommand) {
    write({ ok: true, command: 'help', data: buildAppHelp() }, jsonMode);
    return;
  }

  try {
    switch (command) {
      case 'health': {
        const payload = await requestJson('GET', '/health', { token: getAuthToken() });
        write({ ok: true, command: 'health', data: payload }, true);
        return;
      }
      case 'batch-context': {
        const workspaceId = requireOption(options, 'workspaceId', command, jsonMode);
        const batchId = requireOption(options, 'batchId', command, jsonMode);
        const payload = await requestJson(
          'GET',
          '/workspaces/' + encodeURIComponent(workspaceId) + '/batches/' + encodeURIComponent(batchId) + '/context'
        );
        write({ ok: true, command, data: payload }, true);
        return;
      }
      case 'find-related-articles': {
        const workspaceId = requireOption(options, 'workspaceId', command, jsonMode);
        const batchId = getString(options, 'batchId');
        const articleId = getString(options, 'articleId', 'localeVariantId');
        const familyId = getString(options, 'familyId');
        if (!batchId && !articleId && !familyId) {
          fail(command, '--batch-id, --family-id, or --article-id is required', 'VALIDATION_ERROR', jsonMode);
        }
        const limit = getString(options, 'limit');
        const minScore = getString(options, 'minScore');
        const payload = await requestJson(
          'POST',
          '/workspaces/' + encodeURIComponent(workspaceId) + '/articles/related',
          undefined,
          {
            ...(batchId ? { batchId } : {}),
            ...(articleId ? { articleId } : {}),
            ...(familyId ? { familyId } : {}),
            ...(limit ? { limit: Number(limit) } : {}),
            ...(minScore ? { minScore: Number(minScore) } : {}),
            includeEvidence: true
          }
        );
        write({ ok: true, command, data: payload }, true);
        return;
      }
      case 'search-kb': {
        const workspaceId = requireOption(options, 'workspaceId', command, jsonMode);
        const query = requireOption(options, 'query', command, jsonMode);
        const payload = await requestJson(
          'GET',
          '/workspaces/' + encodeURIComponent(workspaceId) + '/articles/search',
          { query }
        );
        write({ ok: true, command, data: payload }, true);
        return;
      }
      case 'get-article':
      case 'get-article-manual': {
        const workspaceId = requireOption(options, 'workspaceId', command, jsonMode);
        const payload = await resolveArticle(workspaceId, options, command, jsonMode);
        write({ ok: true, command, data: payload }, true);
        return;
      }
      case 'get-article-family': {
        const workspaceId = requireOption(options, 'workspaceId', command, jsonMode);
        const familyId = requireOption(options, 'familyId', command, jsonMode);
        const payload = await requestJson(
          'GET',
          '/workspaces/' + encodeURIComponent(workspaceId) + '/articles/families/' + encodeURIComponent(familyId)
        );
        write({ ok: true, command, data: payload }, true);
        return;
      }
      case 'app': {
        const action = subcommand;
        if (!action || !['get-form-schema', 'patch-form'].includes(action)) {
          fail(command, 'app subcommand must be get-form-schema or patch-form', 'VALIDATION_ERROR', jsonMode);
        }
        const workspaceId = requireOption(options, 'workspaceId', command, jsonMode);
        const route = requireOption(options, 'route', command, jsonMode);
        const entityType = requireOption(options, 'entityType', command, jsonMode);
        const entityId = requireOption(options, 'entityId', command, jsonMode);

        if (action === 'get-form-schema') {
          const payload = await requestJson(
            'GET',
            '/workspaces/' + encodeURIComponent(workspaceId) + '/app/form-schema',
            { route, entityType, entityId }
          );
          write({ ok: true, command: 'app ' + action, data: payload }, true);
          return;
        }

        const patch = getJsonObjectOption(options, 'patch', 'patchFile', command, jsonMode);
        if (!patch) {
          fail(command, 'Either --patch or --patch-file is required', 'VALIDATION_ERROR', jsonMode);
        }
        const payload = await requestJson(
          'POST',
          '/workspaces/' + encodeURIComponent(workspaceId) + '/app/patch-form',
          undefined,
          {
            route,
            entityType,
            entityId,
            versionToken: getString(options, 'versionToken'),
            patch
          }
        );
        write({ ok: true, command: 'app ' + action, data: payload }, true);
        return;
      }
      case 'proposal': {
        const action = subcommand;
        if (!action || !['create', 'edit', 'retire'].includes(action)) {
          fail(command, 'proposal subcommand must be create, edit, or retire', 'VALIDATION_ERROR', jsonMode);
        }
        const workspaceId = requireOption(options, 'workspaceId', command, jsonMode);
        const batchId = requireOption(options, 'batchId', command, jsonMode);
        const metadata = getJsonMetadata(options, command, jsonMode);
        const payload = await requestJson(
          'POST',
          '/workspaces/' + encodeURIComponent(workspaceId) + '/proposals/' + action,
          undefined,
          {
            batchId,
            sessionId: getString(options, 'sessionId') || '',
            localeVariantId: getString(options, 'localeVariantId'),
            note: getString(options, 'note') || '',
            rationale: getString(options, 'rationale'),
            pbiIds: getCsvList(options, 'pbiIds', 'pbiId'),
            metadata
          }
        );
        write({ ok: true, command: 'proposal ' + action, data: payload }, true);
        return;
      }
      default:
        fail(command, "unknown command '" + command + "'", 'VALIDATION_ERROR', jsonMode);
    }
  } catch (error) {
    fail(command, error instanceof Error ? error.message : String(error), 'RUNTIME_ERROR', true);
  }
})().catch((error) => {
  fail('runtime', error instanceof Error ? error.message : String(error), 'RUNTIME_ERROR', true);
});
`;
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

  private ensureShimBinary(): string {
    fs.mkdirSync(KB_CLI_SHIM_DIR, { recursive: true });
    const source = buildKbCliShimSource();

    if (process.platform === 'win32') {
      const scriptPath = path.join(KB_CLI_SHIM_DIR, 'kb.js');
      const wrapperPath = path.join(KB_CLI_SHIM_DIR, 'kb.cmd');
      if (!fs.existsSync(scriptPath) || fs.readFileSync(scriptPath, 'utf8') !== source) {
        fs.writeFileSync(scriptPath, source, 'utf8');
      }
      const wrapperSource = `@echo off\r\nnode "%~dp0\\kb.js" %*\r\n`;
      if (!fs.existsSync(wrapperPath) || fs.readFileSync(wrapperPath, 'utf8') !== wrapperSource) {
        fs.writeFileSync(wrapperPath, wrapperSource, 'utf8');
      }
      return wrapperPath;
    }

    const binaryPath = path.join(KB_CLI_SHIM_DIR, 'kb');
    if (!fs.existsSync(binaryPath) || fs.readFileSync(binaryPath, 'utf8') !== source) {
      fs.writeFileSync(binaryPath, source, 'utf8');
    }
    fs.chmodSync(binaryPath, 0o755);
    return binaryPath;
  }

  getBinaryName(): string {
    return 'kb';
  }

  resolveBinaryPath(): string | null {
    return this.ensureShimBinary();
  }

  getEnvironment(): Record<string, string> {
    const shimBinaryPath = this.resolveBinaryPath() || this.ensureShimBinary();
    const baseUrl = this.loopbackService.getBaseUrl() ?? '';
    const authToken = this.loopbackService.getAuthToken();
    const shimDir = path.dirname(shimBinaryPath);
    const existingPath = process.env.PATH ?? '';
    const normalizedPath = existingPath.startsWith(`${shimDir}${path.delimiter}`)
      ? existingPath
      : `${shimDir}${path.delimiter}${existingPath}`;
    return {
      PATH: normalizedPath,
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
    delete process.env.KBV_KB_CLI_BINARY;
    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value;
    }
  }

  buildPromptSuffix(): string {
    const binaryPath = this.resolveBinaryPath() || this.getBinaryName();
    return [
      'CLI transport is preconfigured by KB Vault.',
      `Use this exact KB Vault CLI binary for every command: \`${binaryPath}\`. Do not rely on any other installed \`kb\` binary.`,
      'Do not invent localhost URLs or auth tokens.',
      'The proposal commands you need are available through this binary:',
      `- \`${binaryPath} proposal create --workspace-id <workspace-id> --batch-id <batch-id> --session-id <session-id> --note "<note>" --rationale "<rationale>" --pbi-ids "<comma-separated-pbi-ids>" --metadata '{"targetTitle":"<article title>","confidenceScore":0.82,"proposedHtml":"<html>...</html>"}' --json\``,
      `- \`${binaryPath} proposal edit --workspace-id <workspace-id> --batch-id <batch-id> --session-id <session-id> --locale-variant-id <locale-variant-id> --note "<note>" --rationale "<rationale>" --pbi-ids "<comma-separated-pbi-ids>" --metadata '{"targetTitle":"<article title>","confidenceScore":0.82,"proposedHtml":"<html>...</html>"}' --json\``,
      `- \`${binaryPath} proposal edit --workspace-id <workspace-id> --batch-id <batch-id> --session-id <session-id> --locale-variant-id <locale-variant-id> --note "<note>" --rationale "<rationale>" --pbi-ids "<comma-separated-pbi-ids>" --metadata-file /tmp/proposal-metadata.json --json\``,
      `- \`${binaryPath} proposal retire --workspace-id <workspace-id> --batch-id <batch-id> --session-id <session-id> --locale-variant-id <locale-variant-id> --note "<note>" --rationale "<rationale>" --pbi-ids "<comma-separated-pbi-ids>" --metadata '{"targetTitle":"<article title>"}' --json\``,
      'The form-editing commands you need are also available through this binary:',
      `- \`${binaryPath} app get-form-schema --workspace-id <workspace-id> --route templates_and_prompts --entity-type template_pack --entity-id <entity-id> --json\``,
      `- \`${binaryPath} app patch-form --workspace-id <workspace-id> --route templates_and_prompts --entity-type template_pack --entity-id <entity-id> --version-token <version-token> --patch '{"promptTemplate":"..."}' --json\``,
      `- \`${binaryPath} app patch-form --workspace-id <workspace-id> --route templates_and_prompts --entity-type template_pack --entity-id <entity-id> --patch-file /tmp/template-patch.json --json\``,
      `- \`${binaryPath} app get-form-schema --workspace-id <workspace-id> --route proposal_review --entity-type proposal --entity-id <proposal-id> --json\``,
      `- \`${binaryPath} app patch-form --workspace-id <workspace-id> --route proposal_review --entity-type proposal --entity-id <proposal-id> --version-token <version-token> --patch '{"html":"<updated proposal html>"}' --json\``,
      'For create proposals, always include `metadata.targetTitle`.',
      'For create/edit proposals, include the full final article HTML in `metadata.proposedHtml` when you have it.',
      'For every persisted proposal, include `metadata.confidenceScore` as a numeric value from 0 to 1.',
      'For live form edits, load the form schema first when you need field names or the current version token.',
      'When you are editing the currently open proposal in Proposal Review, use the `kb app` proposal_review commands above instead of `kb proposal create/edit`.',
      'Never claim a form field changed unless `kb app patch-form` succeeded.',
      'If the HTML is too large or awkward for an inline JSON shell argument, write the metadata JSON to a temporary file and use `--metadata-file` instead of narrating escaping strategy.',
      `If syntax is unclear, call \`${binaryPath} help --json\`, \`${binaryPath} proposal --json\`, or \`${binaryPath} app --json\` before trying a resource command.`
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
