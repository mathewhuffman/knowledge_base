"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZendeskClient = exports.ZendeskApiError = void 0;
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
    async request(path, params = {}) {
        const url = new URL(path, `${this.baseHost}/`);
        Object.entries(params).forEach(([key, value]) => {
            url.searchParams.set(key, String(value));
        });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: this.getAuthHeader()
            },
            signal: controller.signal
        });
        clearTimeout(timeout);
        if (!response.ok) {
            const responseBody = await response.text().catch(() => '');
            throw new ZendeskApiError(`Zendesk API error for ${path}: ${response.status} ${response.statusText}`, response.status, responseBody);
        }
        return (await response.json());
    }
    async requestWithRetry(path, params, attempts = 3) {
        const payload = params ?? {};
        let attempt = 0;
        while (true) {
            try {
                return await this.request(path, payload);
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
                const result = await this.requestWithRetry(check.path, { per_page: 1 });
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
            const data = await this.requestWithRetry(nextPage, { per_page: 100 });
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
            const data = await this.requestWithRetry(nextPage, { per_page: 100 });
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
        const data = await this.requestWithRetry(`/api/v2/help_center/${encodeURIComponent(locale)}/articles.json`, { per_page: 100, page });
        const items = since ? data.articles.filter((article) => (article.updated_at ? article.updated_at > since : true)) : data.articles;
        return {
            items,
            hasMore: Boolean(data.next_page),
            nextPage: data.next_page ?? undefined
        };
    }
    async searchArticles(locale, query) {
        const data = await this.requestWithRetry('/api/v2/help_center/search.json', {
            per_page: 100,
            page: 1,
            query: `type:article locale:${locale} ${query}`
        });
        return data.articles ?? [];
    }
}
exports.ZendeskClient = ZendeskClient;
