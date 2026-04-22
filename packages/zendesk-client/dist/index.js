"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZendeskClient = exports.ZendeskApiError = void 0;
const node_child_process_1 = require("node:child_process");
const node_http_1 = __importDefault(require("node:http"));
const node_https_1 = __importDefault(require("node:https"));
const node_tls_1 = __importDefault(require("node:tls"));
class ZendeskApiError extends Error {
    status;
    responseBody;
    constructor(message, status, responseBody) {
        super(message);
        this.name = 'ZendeskApiError';
        this.status = status;
        this.responseBody = responseBody;
    }
    get isRateLimitError() {
        return this.status === 429;
    }
}
exports.ZendeskApiError = ZendeskApiError;
let macOsSystemCertificates;
function splitPemCertificates(pemBundle) {
    const matches = pemBundle.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    return matches?.map((certificate) => certificate.trim()).filter(Boolean) ?? [];
}
function getDefaultCaCertificates() {
    const tlsWithSystemCerts = node_tls_1.default;
    if (typeof tlsWithSystemCerts.getCACertificates === 'function') {
        return tlsWithSystemCerts.getCACertificates('default');
    }
    return [...node_tls_1.default.rootCertificates];
}
function getMacSystemCertificates() {
    if (process.platform !== 'darwin') {
        return undefined;
    }
    if (macOsSystemCertificates !== undefined) {
        return macOsSystemCertificates ?? undefined;
    }
    try {
        const tlsWithSystemCerts = node_tls_1.default;
        macOsSystemCertificates = typeof tlsWithSystemCerts.getCACertificates === 'function'
            ? tlsWithSystemCerts.getCACertificates('system')
            : splitPemCertificates((0, node_child_process_1.execSync)('security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain 2>/dev/null; ' +
                'security find-certificate -a -p /Library/Keychains/System.keychain 2>/dev/null; ' +
                'security find-certificate -a -p ~/Library/Keychains/login.keychain-db 2>/dev/null', { encoding: 'utf8', timeout: 5000 }));
    }
    catch {
        macOsSystemCertificates = null;
    }
    return macOsSystemCertificates ?? undefined;
}
function getTrustedCaCertificates() {
    const systemCertificates = getMacSystemCertificates();
    if (!systemCertificates?.length) {
        return undefined;
    }
    return Array.from(new Set([...getDefaultCaCertificates(), ...systemCertificates]));
}
function hasHeader(headers, name) {
    const target = name.toLowerCase();
    return Object.keys(headers).some((key) => key.toLowerCase() === target);
}
async function normalizeRequestBody(body) {
    if (!body) {
        return undefined;
    }
    if (typeof body === 'string' || body instanceof Uint8Array) {
        return body;
    }
    if (body instanceof URLSearchParams) {
        return body.toString();
    }
    if (body instanceof ArrayBuffer) {
        return new Uint8Array(body);
    }
    if (ArrayBuffer.isView(body)) {
        return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
        return new Uint8Array(await body.arrayBuffer());
    }
    return JSON.stringify(body);
}
class ZendeskClient {
    baseHost;
    timeoutMs;
    credentials;
    constructor(config) {
        this.baseHost = `https://${config.credentials.subdomain}.zendesk.com`;
        this.timeoutMs = config.timeoutMs ?? 30_000;
        this.credentials = config.credentials;
    }
    isConfigured() {
        return Boolean(this.credentials.subdomain) && Boolean(this.credentials.email) && Boolean(this.credentials.apiToken);
    }
    static fromConfig(config, credentials) {
        return new ZendeskClient({
            timeoutMs: config.timeoutMs,
            credentials
        });
    }
    getAuthHeader() {
        const token = `${this.credentials.email}/token:${this.credentials.apiToken}`;
        if (typeof btoa === 'function') {
            return `Basic ${btoa(token)}`;
        }
        const bufferFrom = globalThis.Buffer?.from;
        const encoded = bufferFrom?.(token, 'utf8').toString('base64');
        if (typeof encoded === 'string' && encoded.length > 0) {
            return `Basic ${encoded}`;
        }
        throw new Error('Missing base64 encoder for Zendesk auth');
    }
    async sendRequest(url, options = {}) {
        const headers = {
            ...(options.headers ?? {})
        };
        const body = await normalizeRequestBody(options.body);
        if (body && !hasHeader(headers, 'Content-Length')) {
            headers['Content-Length'] = String(typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength);
        }
        return new Promise((resolve, reject) => {
            const requestOptions = {
                method: options.method ?? 'GET',
                headers,
                timeout: this.timeoutMs
            };
            if (url.protocol === 'https:') {
                const trustedCaCertificates = getTrustedCaCertificates();
                if (trustedCaCertificates?.length) {
                    requestOptions.ca = trustedCaCertificates;
                }
            }
            const request = (url.protocol === 'https:' ? node_https_1.default : node_http_1.default).request(url, requestOptions, (response) => {
                const chunks = [];
                response.on('data', (chunk) => {
                    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
                });
                response.on('end', () => {
                    resolve({
                        status: response.statusCode ?? 0,
                        statusText: response.statusMessage ?? '',
                        bodyText: Buffer.concat(chunks).toString('utf8')
                    });
                });
            });
            request.on('timeout', () => {
                request.destroy(new Error(`Request timed out after ${this.timeoutMs}ms`));
            });
            request.on('error', reject);
            if (body) {
                request.write(body);
            }
            request.end();
        });
    }
    async request(path, options = {}) {
        const url = new URL(path, `${this.baseHost}/`);
        Object.entries(options.params ?? {}).forEach(([key, value]) => {
            if (value === null || value === undefined) {
                return;
            }
            url.searchParams.set(key, String(value));
        });
        const headers = {
            Accept: 'application/json',
            Authorization: this.getAuthHeader(),
            ...(options.headers ?? {})
        };
        if (options.body && typeof FormData !== 'undefined' && options.body instanceof FormData) {
            throw new Error('ZendeskClient does not support FormData request bodies');
        }
        if (options.body && !hasHeader(headers, 'Content-Type')) {
            headers['Content-Type'] = 'application/json';
        }
        const response = await this.sendRequest(url, {
            ...options,
            headers
        });
        if (response.status < 200 || response.status >= 300) {
            throw new ZendeskApiError(`Zendesk API error for ${path}: ${response.status} ${response.statusText}`, response.status, response.bodyText);
        }
        if (response.status === 204) {
            return undefined;
        }
        if (!response.bodyText.trim()) {
            return undefined;
        }
        return JSON.parse(response.bodyText);
    }
    async requestWithRetry(path, options = {}, attempts = 3) {
        let attempt = 0;
        while (true) {
            try {
                return await this.request(path, options);
            }
            catch (error) {
                attempt += 1;
                if (error instanceof ZendeskApiError && error.isRateLimitError && attempt < attempts) {
                    await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt * 200, 2000)));
                    continue;
                }
                throw error;
            }
        }
    }
    async testConnection() {
        const fallbackChecks = [
            { path: '/api/v2/users/me.json', parse: (value) => Boolean(value?.user) },
            { path: '/api/v2/help_center/articles/count.json', parse: (value) => typeof value.count === 'number' }
        ];
        let lastError;
        for (const check of fallbackChecks) {
            try {
                const result = await this.requestWithRetry(check.path, { params: { per_page: 1 } });
                if (check.parse(result)) {
                    return { ok: true, status: 200 };
                }
            }
            catch (error) {
                lastError = error;
                if (error instanceof ZendeskApiError && error.status === 404) {
                    continue;
                }
                throw error;
            }
        }
        throw lastError;
    }
    async listCategories(locale) {
        const all = [];
        let nextPage = `/api/v2/help_center/${encodeURIComponent(locale)}/categories.json`;
        while (nextPage) {
            const data = await this.requestWithRetry(nextPage, { params: { per_page: 100 } });
            all.push(...(data.categories ?? []));
            const next = data.next_page;
            if (typeof next === 'string' && next) {
                const parsed = new URL(next);
                nextPage = `${parsed.pathname}${parsed.search}`;
            }
            else {
                nextPage = null;
            }
        }
        return all;
    }
    async listSections(categoryId, locale) {
        const all = [];
        let nextPage = `/api/v2/help_center/${encodeURIComponent(locale)}/categories/${categoryId}/sections.json`;
        while (nextPage) {
            const data = await this.requestWithRetry(nextPage, { params: { per_page: 100 } });
            all.push(...(data.sections ?? []));
            const next = data.next_page;
            if (typeof next === 'string' && next) {
                const parsed = new URL(next);
                nextPage = `${parsed.pathname}${parsed.search}`;
            }
            else {
                nextPage = null;
            }
        }
        return all;
    }
    async listArticles(locale, page = 1, since) {
        const data = await this.requestWithRetry(`/api/v2/help_center/${encodeURIComponent(locale)}/articles.json`, { params: { per_page: 100, page } });
        const items = since ? data.articles.filter((article) => (article.updated_at ? article.updated_at > since : true)) : data.articles;
        return {
            items,
            hasMore: Boolean(data.next_page),
            nextPage: data.next_page ?? undefined
        };
    }
    async searchArticles(locale, query) {
        const data = await this.requestWithRetry('/api/v2/help_center/search.json', {
            params: {
                per_page: 100,
                page: 1,
                query: `type:article locale:${locale} ${query}`
            }
        });
        return data.articles ?? [];
    }
    async listEnabledLocales() {
        const locales = await this.requestWithRetry('/api/v2/help_center/locales.json', { params: { per_page: 100 } });
        return locales.locales ?? [];
    }
    async showArticle(articleId, locale) {
        const path = locale?.trim()
            ? `/api/v2/help_center/${encodeURIComponent(locale.trim())}/articles/${articleId}.json`
            : `/api/v2/help_center/articles/${articleId}.json`;
        const response = await this.requestWithRetry(path);
        return response.article;
    }
    async listTranslations(articleId) {
        const response = await this.requestWithRetry(`/api/v2/help_center/articles/${articleId}/translations.json`);
        return response.translations ?? [];
    }
    async listMissingTranslations(articleId) {
        const [locales, translations] = await Promise.all([
            this.listEnabledLocales(),
            this.listTranslations(articleId)
        ]);
        const translated = new Set(translations.map((translation) => translation.locale.toLowerCase()));
        return locales
            .map((locale) => locale.locale)
            .filter((locale) => Boolean(locale))
            .filter((locale) => !translated.has(locale.toLowerCase()));
    }
    async createArticleInSection(sectionId, article) {
        return this.createArticleInSectionWithOptions(sectionId, article);
    }
    async createArticleInSectionWithOptions(sectionId, article, options) {
        const response = await this.requestWithRetry(`/api/v2/help_center/sections/${sectionId}/articles.json`, {
            method: 'POST',
            body: {
                article,
                notify_subscribers: options?.notifySubscribers
            }
        });
        return response.article;
    }
    async updateArticleMetadata(articleId, article) {
        return this.updateArticleMetadataWithOptions(articleId, article);
    }
    async updateArticleMetadataWithOptions(articleId, article, options) {
        const response = await this.requestWithRetry(`/api/v2/help_center/articles/${articleId}.json`, {
            method: 'PUT',
            body: {
                article,
                notify_subscribers: options?.notifySubscribers
            }
        });
        return response.article;
    }
    async createTranslation(articleId, translation) {
        const response = await this.requestWithRetry(`/api/v2/help_center/articles/${articleId}/translations.json`, {
            method: 'POST',
            body: {
                translation
            }
        });
        return response.translation;
    }
    async updateTranslation(articleId, locale, translation) {
        const normalizedLocale = locale.trim();
        const response = await this.requestWithRetry(`/api/v2/help_center/articles/${articleId}/translations/${encodeURIComponent(normalizedLocale)}.json`, {
            method: 'PUT',
            body: {
                translation
            }
        });
        return response.translation;
    }
    async upsertTranslation(articleId, translation) {
        const normalizedLocale = translation.locale.trim().toLowerCase();
        const existing = await this.listTranslations(articleId);
        const match = existing.find((item) => item.locale.trim().toLowerCase() === normalizedLocale);
        if (match) {
            return this.updateTranslation(articleId, translation.locale, translation);
        }
        return this.createTranslation(articleId, translation);
    }
    async createCategory(locale, category) {
        const path = locale?.trim()
            ? `/api/v2/help_center/${encodeURIComponent(locale.trim())}/categories.json`
            : '/api/v2/help_center/categories.json';
        const response = await this.requestWithRetry(path, {
            method: 'POST',
            body: {
                category
            }
        });
        return response.category;
    }
    async createSection(categoryId, locale, section) {
        const path = locale?.trim()
            ? `/api/v2/help_center/${encodeURIComponent(locale.trim())}/categories/${categoryId}/sections.json`
            : `/api/v2/help_center/categories/${categoryId}/sections.json`;
        const response = await this.requestWithRetry(path, {
            method: 'POST',
            body: {
                section
            }
        });
        return response.section;
    }
    async createGuideMediaUploadUrl(contentType, fileSize) {
        return this.requestWithRetry('/api/v2/guide/medias/upload_url', {
            method: 'POST',
            body: {
                content_type: contentType,
                file_size: fileSize
            }
        });
    }
    async uploadGuideMedia(uploadUrl, headers, body) {
        const response = await this.sendRequest(new URL(uploadUrl), {
            method: 'PUT',
            headers,
            body
        });
        if (response.status < 200 || response.status >= 300) {
            throw new ZendeskApiError(`Zendesk media upload failed: ${response.status} ${response.statusText}`, response.status, response.bodyText);
        }
    }
    async createGuideMedia(assetUploadId, filename) {
        const response = await this.requestWithRetry('/api/v2/guide/medias', {
            method: 'POST',
            body: {
                asset_upload_id: assetUploadId,
                filename
            }
        });
        return response.media;
    }
    async archiveArticle(articleId, locale) {
        await this.requestWithRetry(`/api/v2/help_center/${encodeURIComponent(locale.trim())}/articles/${articleId}.json`, {
            method: 'DELETE'
        });
    }
}
exports.ZendeskClient = ZendeskClient;
