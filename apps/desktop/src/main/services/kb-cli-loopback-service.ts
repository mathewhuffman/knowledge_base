import { createHash, randomUUID } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { ProposalAction, type AppWorkingStatePatchRequest, type AppWorkingStateSchemaRequest, type SearchPayload } from '@kb-vault/shared-types';
import { WorkspaceRepository } from './workspace-repository';
import { AppWorkingStateService } from './app-working-state-service';
import { applyAppWorkingStatePatch } from './proposal-working-state';

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) {
    return {};
  }

  const parsed = JSON.parse(text) as unknown;
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

function parseBoolean(value: string | null): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function clampLimit(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const normalized = Math.floor(value);
  if (normalized > 100) {
    return 100;
  }
  return normalized;
}

function parseCsvParam(url: URL, key: string): string[] | undefined {
  const value = url.searchParams.get(key)?.trim();
  if (!value) {
    return undefined;
  }
  const parts = value.split(',').map((item) => item.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildProposalIdempotencyKey(action: ProposalAction, body: Record<string, unknown>): string {
  const normalized = {
    action,
    batchId: typeof body.batchId === 'string' ? body.batchId.trim() : '',
    sessionId: typeof body.sessionId === 'string' ? body.sessionId.trim() : '',
    localeVariantId: typeof body.localeVariantId === 'string' ? body.localeVariantId.trim() : '',
    note: typeof body.note === 'string' ? body.note.trim() : '',
    rationale: typeof body.rationale === 'string' ? body.rationale.trim() : '',
    pbiIds: Array.isArray(body.pbiIds)
      ? body.pbiIds.map((value) => String(value).trim()).filter(Boolean).sort()
      : [],
    metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : {}
  };
  return createHash('sha256').update(stableStringify(normalized)).digest('hex');
}

export class KbCliLoopbackService {
  private server: http.Server | null = null;
  private baseUrl: string | null = null;
  private authToken = randomUUID();

  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly appWorkingStateService: AppWorkingStateService
  ) {}

  async start(): Promise<void> {
    if (this.server && this.baseUrl) {
      return;
    }

    this.authToken = randomUUID();
    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server?.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server?.off('error', onError);
        const address = this.server?.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Loopback service did not bind a TCP port'));
          return;
        }
        this.baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      };

      this.server?.once('error', onError);
      this.server?.once('listening', onListening);
      this.server?.listen(0, '127.0.0.1');
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      this.baseUrl = null;
      return;
    }

    const server = this.server;
    this.server = null;
    this.baseUrl = null;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  isRunning(): boolean {
    return Boolean(this.server && this.baseUrl);
  }

  getBaseUrl(): string | null {
    return this.baseUrl;
  }

  getAuthToken(): string {
    return this.authToken;
  }

  private isAuthorized(request: IncomingMessage, url: URL): boolean {
    const authorization = request.headers.authorization?.trim();
    const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
    const queryToken = url.searchParams.get('token')?.trim() ?? '';
    const headerToken = typeof request.headers['x-kbv-token'] === 'string' ? request.headers['x-kbv-token'].trim() : '';
    return [bearerToken, queryToken, headerToken].some((value) => value && value === this.authToken);
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', this.baseUrl ?? 'http://127.0.0.1');
    const route = `${request.method ?? 'GET'} ${url.pathname}`;

    if (url.pathname === '/health' && request.method === 'GET') {
      sendJson(response, 200, {
        ok: true,
        service: 'kb-cli-loopback',
        baseUrl: this.baseUrl,
        availableRoutes: [
          'GET /health',
          'GET /workspaces/:workspaceId/batches/:batchId/context',
          'GET /workspaces/:workspaceId/batches/:batchId/pbis',
          'GET /workspaces/:workspaceId/articles/search',
          'GET /workspaces/:workspaceId/articles/variants/:localeVariantId',
          'GET /workspaces/:workspaceId/articles/families/:articleFamilyId',
          'GET /workspaces/:workspaceId/articles/history/:localeVariantId',
          'GET /workspaces/:workspaceId/explorer-tree',
          'GET /workspaces/:workspaceId/categories',
          'GET /workspaces/:workspaceId/sections',
          'GET /workspaces/:workspaceId/templates',
          'GET /workspaces/:workspaceId/templates/:templatePackId',
          'GET /workspaces/:workspaceId/app/form-schema',
          'GET /workspaces/:workspaceId/pbis/:pbiId',
          'POST /workspaces/:workspaceId/articles/related',
          'POST /workspaces/:workspaceId/app/patch-form',
          'POST /workspaces/:workspaceId/proposals/create',
          'POST /workspaces/:workspaceId/proposals/edit',
          'POST /workspaces/:workspaceId/proposals/retire',
          'POST /workspaces/:workspaceId/agent-notes'
        ]
      });
      return;
    }

    if (!this.isAuthorized(request, url)) {
      sendJson(response, 401, {
        ok: false,
        error: 'Unauthorized'
      });
      return;
    }

    try {
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments[0] !== 'workspaces' || !segments[1]) {
        sendJson(response, 404, { ok: false, error: `No CLI route for ${route}` });
        return;
      }

      const workspaceId = decodeURIComponent(segments[1]);

      if (request.method === 'GET' && segments[2] === 'batches' && segments[3] && segments[4] === 'context') {
        const batchId = decodeURIComponent(segments[3]);
        const context = await this.workspaceRepository.getBatchContext(workspaceId, batchId);
        if (!context) {
          sendJson(response, 404, { ok: false, error: 'Batch not found' });
          return;
        }
        sendJson(response, 200, { ok: true, ...context });
        return;
      }

      if (request.method === 'GET' && segments[2] === 'batches' && segments[3] && segments[4] === 'pbis') {
        const batchId = decodeURIComponent(segments[3]);
        const rowNumbersParam = url.searchParams.get('rowNumbers');
        const rowNumbers = rowNumbersParam
          ? rowNumbersParam.split(',').map(Number).filter((n) => !Number.isNaN(n))
          : undefined;
        const result = await this.workspaceRepository.getPBISubset(workspaceId, batchId, rowNumbers);
        sendJson(response, 200, { ok: true, ...result });
        return;
      }

      if (request.method === 'GET' && segments[2] === 'articles' && segments[3] === 'search') {
        const payload: SearchPayload = {
          workspaceId,
          query: url.searchParams.get('query') ?? url.searchParams.get('q') ?? '',
          scope: (url.searchParams.get('scope') as SearchPayload['scope']) ?? 'all',
          includeArchived: parseBoolean(url.searchParams.get('includeArchived')),
          changedWithinHours: url.searchParams.get('changedWithinHours')
            ? Number(url.searchParams.get('changedWithinHours'))
            : undefined,
          localeVariantIds: parseCsvParam(url, 'localeVariantIds'),
          familyIds: parseCsvParam(url, 'familyIds'),
          revisionIds: parseCsvParam(url, 'revisionIds')
        };
        const result = await this.workspaceRepository.searchArticles(workspaceId, payload);
        sendJson(response, 200, { ok: true, ...result });
        return;
      }

      if (request.method === 'GET' && segments[2] === 'articles' && segments[3] === 'variants' && segments[4]) {
        const localeVariantId = decodeURIComponent(segments[4]);
        const detail = await this.workspaceRepository.getArticleDetail(workspaceId, {
          workspaceId,
          localeVariantId,
          includePublishLog: true,
          includeLineage: true
        });
        sendJson(response, 200, { ok: true, article: detail });
        return;
      }

      if (request.method === 'GET' && segments[2] === 'articles' && segments[3] === 'families' && segments[4]) {
        const articleFamilyId = decodeURIComponent(segments[4]);
        const family = await this.workspaceRepository.getArticleFamily(workspaceId, articleFamilyId);
        const variants = await this.workspaceRepository.getLocaleVariantsForFamily(workspaceId, articleFamilyId);
        const revisions = (await Promise.all(variants.map((variant) =>
          this.workspaceRepository.listRevisions(workspaceId, variant.id)
        ))).flat();

        sendJson(response, 200, {
          ok: true,
          family,
          variants,
          revisions
        });
        return;
      }

      if (request.method === 'GET' && segments[2] === 'articles' && segments[3] === 'history' && segments[4]) {
        const localeVariantId = decodeURIComponent(segments[4]);
        const history = await this.workspaceRepository.getHistory(workspaceId, localeVariantId);
        sendJson(response, 200, { ok: true, ...history });
        return;
      }

      if (request.method === 'GET' && segments[2] === 'explorer-tree' && !segments[3]) {
        const tree = await this.workspaceRepository.getExplorerTree(workspaceId);
        sendJson(response, 200, { ok: true, tree });
        return;
      }

      if (request.method === 'GET' && segments[2] === 'categories' && !segments[3]) {
        const tree = await this.workspaceRepository.getExplorerTree(workspaceId);
        sendJson(response, 200, { ok: true, workspaceId, source: 'local', tree });
        return;
      }

      if (request.method === 'GET' && segments[2] === 'sections' && !segments[3]) {
        const tree = await this.workspaceRepository.getExplorerTree(workspaceId);
        sendJson(response, 200, { ok: true, workspaceId, source: 'local', tree });
        return;
      }

      if (request.method === 'GET' && segments[2] === 'templates' && !segments[3]) {
        const templates = await this.workspaceRepository.listTemplatePacks(workspaceId);
        sendJson(response, 200, { ok: true, workspaceId, templates });
        return;
      }

      if (request.method === 'GET' && segments[2] === 'templates' && segments[3]) {
        const templatePackId = decodeURIComponent(segments[3]);
        const template = await this.workspaceRepository.getTemplatePack(workspaceId, templatePackId);
        if (!template) {
          sendJson(response, 404, { ok: false, error: 'Template not found' });
          return;
        }
        sendJson(response, 200, { ok: true, ...template });
        return;
      }

      if (request.method === 'GET' && segments[2] === 'app' && segments[3] === 'form-schema') {
        const routeParam = url.searchParams.get('route');
        const entityTypeParam = url.searchParams.get('entityType');
        const entityIdParam = url.searchParams.get('entityId');
        if (!routeParam || !entityTypeParam || !entityIdParam) {
          sendJson(response, 400, {
            ok: false,
            error: 'route, entityType, and entityId are required'
          });
          return;
        }
        const payload = this.appWorkingStateService.getFormSchema({
          workspaceId,
          route: routeParam as AppWorkingStateSchemaRequest['route'],
          entityType: entityTypeParam as AppWorkingStateSchemaRequest['entityType'],
          entityId: entityIdParam
        });
        sendJson(response, 200, payload);
        return;
      }

      if (request.method === 'GET' && segments[2] === 'pbis' && segments[3]) {
        const pbiId = decodeURIComponent(segments[3]);
        const pbi = await this.workspaceRepository.getPBIRecord(workspaceId, pbiId);
        if (!pbi) {
          sendJson(response, 404, { ok: false, error: 'PBI not found' });
          return;
        }
        sendJson(response, 200, { ok: true, ...pbi });
        return;
      }

      if (request.method === 'POST' && segments[2] === 'articles' && segments[3] === 'related') {
        const body = await readJsonBody(request);
        const articleId = typeof body.articleId === 'string' ? body.articleId : undefined;
        const familyId = typeof body.familyId === 'string' ? body.familyId : undefined;
        const batchId = typeof body.batchId === 'string' ? body.batchId : undefined;
        const query = typeof body.query === 'string' ? body.query.trim() : '';
        const limit = clampLimit(body.limit) ?? 10;
        const minScore = typeof body.minScore === 'number' ? body.minScore : undefined;
        const includeEvidence = body.includeEvidence !== false;

        if (query && !articleId && !familyId && !batchId) {
          const result = await this.workspaceRepository.queryArticleRelationCoverage({
            workspaceId,
            query,
            maxResults: limit,
            minScore,
            includeEvidence
          });

          sendJson(response, 200, {
            ok: true,
            ...result,
            total: result.results.length,
            results: result.results
          });
          return;
        }

        if (!articleId && !familyId && !batchId) {
          sendJson(response, 400, {
            ok: false,
            error: 'Either query, articleId, familyId, or batchId is required.'
          });
          return;
        }
        const result = await this.workspaceRepository.listArticleRelations(workspaceId, {
          workspaceId,
          localeVariantId: articleId,
          familyId,
          batchId,
          limit,
          minScore,
          includeEvidence
        });

        sendJson(response, 200, {
          ok: true,
          ...result,
          results: result.relations
        });
        return;
      }

      if (request.method === 'POST' && segments[2] === 'app' && segments[3] === 'patch-form') {
        const body = await readJsonBody(request);
        const routeValue = typeof body.route === 'string' ? body.route : '';
        const entityTypeValue = typeof body.entityType === 'string' ? body.entityType : '';
        const entityIdValue = typeof body.entityId === 'string' ? body.entityId : '';
        const patchValue = body.patch;
        if (!routeValue || !entityTypeValue || !entityIdValue) {
          sendJson(response, 400, {
            ok: false,
            error: 'route, entityType, and entityId are required'
          });
          return;
        }
        if (!patchValue || typeof patchValue !== 'object' || Array.isArray(patchValue)) {
          sendJson(response, 400, {
            ok: false,
            error: 'patch must be an object'
          });
          return;
        }
        const patchRequest: AppWorkingStatePatchRequest = {
          workspaceId,
          route: routeValue as AppWorkingStatePatchRequest['route'],
          entityType: entityTypeValue as AppWorkingStatePatchRequest['entityType'],
          entityId: entityIdValue,
          versionToken: typeof body.versionToken === 'string' ? body.versionToken : undefined,
          patch: patchValue as Record<string, unknown>
        };
        try {
          const result = await applyAppWorkingStatePatch({
            workspaceRepository: this.workspaceRepository,
            appWorkingStateService: this.appWorkingStateService,
            request: patchRequest
          });
          sendJson(response, result.ok ? 200 : 409, result);
          return;
        } catch (error) {
          sendJson(response, 500, {
            ok: false,
            error: String((error as Error).message || error)
          });
          return;
        }
      }

      if (request.method === 'POST' && segments[2] === 'proposals' && segments[3]) {
        const actionMap: Record<string, ProposalAction> = {
          create: ProposalAction.CREATE,
          edit: ProposalAction.EDIT,
          retire: ProposalAction.RETIRE
        };
        const action = actionMap[segments[3]];
        if (!action) {
          sendJson(response, 404, { ok: false, error: `Unknown proposal action: ${segments[3]}` });
          return;
        }
        const body = await readJsonBody(request);
        const batchId = typeof body.batchId === 'string' ? body.batchId : '';
        if (!batchId) {
          sendJson(response, 400, { ok: false, error: 'batchId is required for proposal' });
          return;
        }
        const created = await this.workspaceRepository.createAgentProposal({
          workspaceId,
          batchId,
          action,
          _sessionId: typeof body.sessionId === 'string' ? body.sessionId : '',
          idempotencyKey: buildProposalIdempotencyKey(action, body),
          localeVariantId: typeof body.localeVariantId === 'string' ? body.localeVariantId : undefined,
          note: typeof body.note === 'string' ? body.note : '',
          rationale: typeof body.rationale === 'string' ? body.rationale : undefined,
          relatedPbiIds: Array.isArray(body.pbiIds) ? body.pbiIds as string[] : undefined,
          metadata: body.metadata
        });
        sendJson(response, 200, { ok: true, ...created });
        return;
      }

      if (request.method === 'POST' && segments[2] === 'agent-notes' && !segments[3]) {
        const body = await readJsonBody(request);
        if (typeof body.note !== 'string' || !body.note.trim()) {
          sendJson(response, 400, { ok: false, error: 'note is required' });
          return;
        }
        const recorded = await this.workspaceRepository.recordAgentNotes({
          workspaceId,
          sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
          note: body.note,
          metadata: body.metadata,
          batchId: typeof body.batchId === 'string' ? body.batchId : undefined,
          localeVariantId: typeof body.localeVariantId === 'string' ? body.localeVariantId : undefined,
          familyId: typeof body.familyId === 'string' ? body.familyId : undefined,
          pbiIds: Array.isArray(body.pbiIds)
            ? body.pbiIds.filter((entry): entry is string => typeof entry === 'string')
            : undefined,
          rationale: typeof body.rationale === 'string' ? body.rationale : undefined
        });
        sendJson(response, 200, recorded);
        return;
      }

      sendJson(response, 404, { ok: false, error: `No CLI route for ${route}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = /not found/i.test(message) ? 404 : 500;
      sendJson(response, statusCode, {
        ok: false,
        error: message
      });
    }
  }
}
