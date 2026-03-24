"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KbCliLoopbackService = void 0;
const node_crypto_1 = require("node:crypto");
const node_http_1 = __importDefault(require("node:http"));
const node_url_1 = require("node:url");
const shared_types_1 = require("@kb-vault/shared-types");
function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
    });
    response.end(`${JSON.stringify(payload)}\n`);
}
async function readJsonBody(request) {
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text) {
        return {};
    }
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
}
function parseBoolean(value) {
    return value === '1' || value === 'true' || value === 'yes';
}
function clampLimit(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return undefined;
    }
    const normalized = Math.floor(value);
    if (normalized > 100) {
        return 100;
    }
    return normalized;
}
class KbCliLoopbackService {
    workspaceRepository;
    appWorkingStateService;
    server = null;
    baseUrl = null;
    authToken = (0, node_crypto_1.randomUUID)();
    constructor(workspaceRepository, appWorkingStateService) {
        this.workspaceRepository = workspaceRepository;
        this.appWorkingStateService = appWorkingStateService;
    }
    async start() {
        if (this.server && this.baseUrl) {
            return;
        }
        this.authToken = (0, node_crypto_1.randomUUID)();
        this.server = node_http_1.default.createServer((request, response) => {
            void this.handleRequest(request, response);
        });
        await new Promise((resolve, reject) => {
            const onError = (error) => {
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
    async stop() {
        if (!this.server) {
            this.baseUrl = null;
            return;
        }
        const server = this.server;
        this.server = null;
        this.baseUrl = null;
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }
    isRunning() {
        return Boolean(this.server && this.baseUrl);
    }
    getBaseUrl() {
        return this.baseUrl;
    }
    getAuthToken() {
        return this.authToken;
    }
    isAuthorized(request, url) {
        const authorization = request.headers.authorization?.trim();
        const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
        const queryToken = url.searchParams.get('token')?.trim() ?? '';
        const headerToken = typeof request.headers['x-kbv-token'] === 'string' ? request.headers['x-kbv-token'].trim() : '';
        return [bearerToken, queryToken, headerToken].some((value) => value && value === this.authToken);
    }
    async handleRequest(request, response) {
        const url = new node_url_1.URL(request.url ?? '/', this.baseUrl ?? 'http://127.0.0.1');
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
                const payload = {
                    workspaceId,
                    query: url.searchParams.get('query') ?? url.searchParams.get('q') ?? '',
                    scope: url.searchParams.get('scope') ?? 'all',
                    includeArchived: parseBoolean(url.searchParams.get('includeArchived')),
                    changedWithinHours: url.searchParams.get('changedWithinHours')
                        ? Number(url.searchParams.get('changedWithinHours'))
                        : undefined
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
                const revisions = (await Promise.all(variants.map((variant) => this.workspaceRepository.listRevisions(workspaceId, variant.id)))).flat();
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
                    route: routeParam,
                    entityType: entityTypeParam,
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
                const limit = clampLimit(body.limit) ?? 10;
                const minScore = typeof body.minScore === 'number' ? body.minScore : undefined;
                const includeEvidence = body.includeEvidence !== false;
                if (!articleId && !familyId && !batchId) {
                    sendJson(response, 400, {
                        ok: false,
                        error: 'Either articleId, familyId, or batchId is required.'
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
                const result = this.appWorkingStateService.patchForm({
                    workspaceId,
                    route: routeValue,
                    entityType: entityTypeValue,
                    entityId: entityIdValue,
                    versionToken: typeof body.versionToken === 'string' ? body.versionToken : undefined,
                    patch: patchValue
                });
                sendJson(response, result.ok ? 200 : 409, result);
                return;
            }
            if (request.method === 'POST' && segments[2] === 'proposals' && segments[3]) {
                const actionMap = {
                    create: shared_types_1.ProposalAction.CREATE,
                    edit: shared_types_1.ProposalAction.EDIT,
                    retire: shared_types_1.ProposalAction.RETIRE
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
                    localeVariantId: typeof body.localeVariantId === 'string' ? body.localeVariantId : undefined,
                    note: typeof body.note === 'string' ? body.note : '',
                    rationale: typeof body.rationale === 'string' ? body.rationale : undefined,
                    relatedPbiIds: Array.isArray(body.pbiIds) ? body.pbiIds : undefined,
                    metadata: body.metadata
                });
                sendJson(response, 200, { ok: true, ...created });
                return;
            }
            if (request.method === 'POST' && segments[2] === 'agent-notes' && !segments[3]) {
                const body = await readJsonBody(request);
                sendJson(response, 200, {
                    ok: true,
                    workspaceId,
                    recorded: true,
                    note: typeof body.note === 'string' ? body.note : ''
                });
                return;
            }
            sendJson(response, 404, { ok: false, error: `No CLI route for ${route}` });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const statusCode = /not found/i.test(message) ? 404 : 500;
            sendJson(response, statusCode, {
                ok: false,
                error: message
            });
        }
    }
}
exports.KbCliLoopbackService = KbCliLoopbackService;
