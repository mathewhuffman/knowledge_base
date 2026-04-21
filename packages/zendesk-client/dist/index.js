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
    async request(path, options = {}) {
        const url = new URL(path, `${this.baseHost}/`);
        Object.entries(options.params ?? {}).forEach(([key, value]) => {
            if (value === null || value === undefined) {
                return;
            }
            url.searchParams.set(key, String(value));
        });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        const body = options.body;
        const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
        const headers = {
            Accept: 'application/json',
            Authorization: this.getAuthHeader(),
            ...(options.headers ?? {})
        };
        if (body && !isFormData && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }
        const response = await fetch(url, {
            method: options.method ?? 'GET',
            headers,
            body: body
                ? (isFormData || typeof body === 'string' || body instanceof Blob
                    ? body
                    : JSON.stringify(body))
                : undefined,
            signal: controller.signal
        });
        clearTimeout(timeout);
        if (!response.ok) {
            const responseBody = await response.text().catch(() => '');
            throw new ZendeskApiError(`Zendesk API error for ${path}: ${response.status} ${response.statusText}`, response.status, responseBody);
        }
        if (response.status === 204) {
            return undefined;
        }
        const text = await response.text();
        if (!text.trim()) {
            return undefined;
        }
        return JSON.parse(text);
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
        const response = await fetch(uploadUrl, {
            method: 'PUT',
            headers,
            body
        });
        if (!response.ok) {
            const responseBody = await response.text().catch(() => '');
            throw new ZendeskApiError(`Zendesk media upload failed: ${response.status} ${response.statusText}`, response.status, responseBody);
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
