export interface ZendeskCredentials {
  subdomain: string;
  email: string;
  apiToken: string;
}

export interface ZendeskClientConfig {
  timeoutMs: number;
}

export interface ZendeskCategory {
  id: number;
  name: string;
  position?: number;
  outdated?: boolean;
  updated_at?: string;
}

export interface ZendeskSection {
  id: number;
  name: string;
  category_id?: number;
  position?: number;
  outdated?: boolean;
  updated_at?: string;
}

export interface ZendeskArticle {
  id: number;
  title: string;
  body: string;
  locale: string;
  source_id?: number;
  section_id?: number;
  category_id?: number;
  updated_at: string;
}

export interface ZendeskHelpCenterLocale {
  id?: number;
  locale: string;
  name?: string;
  default?: boolean;
  enabled?: boolean;
}

export interface ZendeskTranslation {
  id?: number;
  locale: string;
  title: string;
  body: string;
  draft?: boolean;
  outdated?: boolean;
  source_id?: number;
  updated_at?: string;
}

export interface ZendeskArticleCreatePayload {
  title: string;
  body: string;
  locale: string;
  draft?: boolean;
  permission_group_id?: number;
  user_segment_id?: number;
  user_segment_ids?: number[];
}

export interface ZendeskArticleUpdatePayload {
  section_id?: number;
  permission_group_id?: number | null;
  user_segment_id?: number | null;
  user_segment_ids?: number[] | null;
  draft?: boolean;
}

export interface ZendeskTranslationPayload {
  locale: string;
  title: string;
  body: string;
  draft?: boolean;
}

export interface ZendeskGuideMediaUploadUrlResponse {
  headers: Record<string, string>;
  upload_url: {
    url: string;
    asset_upload_id: string;
  };
}

export interface ZendeskGuideMedia {
  id: string;
  access_key: string;
  name: string;
  size: number;
  url: string;
  content_type: string;
  version?: number;
  created_at?: string;
  updated_at?: string;
}

export interface ZendeskGuideMediaResponse {
  media: ZendeskGuideMedia;
}

export interface ZendeskCategoryPayload {
  locale?: string;
  name: string;
  description?: string;
}

export interface ZendeskSectionPayload {
  locale?: string;
  name: string;
  description?: string;
}

export interface ZendeskPagedResponse<T> {
  count: number;
  next_page: string | null;
  previous_page: string | null;
  page: number;
  per_page: number;
  [key: string]: unknown;
}

export interface ZendeskCategoryResponse extends ZendeskPagedResponse<ZendeskCategory> {
  categories: ZendeskCategory[];
}

export interface ZendeskSectionResponse extends ZendeskPagedResponse<ZendeskSection> {
  sections: ZendeskSection[];
}

export interface ZendeskArticleResponse extends ZendeskPagedResponse<ZendeskArticle> {
  articles: ZendeskArticle[];
}

export interface ZendeskSingleArticleResponse {
  article: ZendeskArticle;
}

export interface ZendeskTranslationResponse {
  translation: ZendeskTranslation;
}

export interface ZendeskTranslationsResponse {
  translations: ZendeskTranslation[];
}

export interface ZendeskHelpCenterLocaleResponse extends ZendeskPagedResponse<ZendeskHelpCenterLocale> {
  locales: ZendeskHelpCenterLocale[];
}

export interface ZendeskConnectionTest {
  ok: boolean;
  status: number;
}

export class ZendeskApiError extends Error {
  public status: number;
  public responseBody?: string;

  constructor(message: string, status: number, responseBody?: string) {
    super(message);
    this.name = 'ZendeskApiError';
    this.status = status;
    this.responseBody = responseBody;
  }

  get isRateLimitError(): boolean {
    return this.status === 429;
  }
}

type CategoryData = ZendeskCategoryResponse & { next_page: string | null };
type SectionData = ZendeskSectionResponse & { next_page: string | null };

interface InternalConfig extends ZendeskClientConfig {
  credentials: ZendeskCredentials;
}

interface ZendeskRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, string | number | boolean | null | undefined>;
  body?: BodyInit | Record<string, unknown>;
  headers?: Record<string, string>;
}

export class ZendeskClient {
  private readonly baseHost: string;
  private readonly timeoutMs: number;
  private readonly credentials: ZendeskCredentials;

  constructor(config: InternalConfig) {
    this.baseHost = `https://${config.credentials.subdomain}.zendesk.com`;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.credentials = config.credentials;
  }

  isConfigured(): boolean {
    return Boolean(this.credentials.subdomain) && Boolean(this.credentials.email) && Boolean(this.credentials.apiToken);
  }

  static fromConfig(config: ZendeskClientConfig, credentials: ZendeskCredentials): ZendeskClient {
    return new ZendeskClient({
      timeoutMs: config.timeoutMs,
      credentials
    });
  }

  private getAuthHeader(): string {
    const token = `${this.credentials.email}/token:${this.credentials.apiToken}`;
    if (typeof btoa === 'function') {
      return `Basic ${btoa(token)}`;
    }
    const bufferFrom = (globalThis as { Buffer?: { from: (input: string, encoding?: string) => { toString: (encoding: 'base64') => string } } }).Buffer?.from;
    const encoded = bufferFrom?.(token, 'utf8').toString('base64');
    if (typeof encoded === 'string' && encoded.length > 0) {
      return `Basic ${encoded}`;
    }
    throw new Error('Missing base64 encoder for Zendesk auth');
  }

  private async request<T>(path: string, options: ZendeskRequestOptions = {}): Promise<T> {
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
    const headers: Record<string, string> = {
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
      throw new ZendeskApiError(
        `Zendesk API error for ${path}: ${response.status} ${response.statusText}`,
        response.status,
        responseBody
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text.trim()) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }

  private async requestWithRetry<T>(path: string, options: ZendeskRequestOptions = {}, attempts = 3): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await this.request<T>(path, options);
      } catch (error) {
        attempt += 1;
        if (error instanceof ZendeskApiError && error.isRateLimitError && attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt * 200, 2000)));
          continue;
        }
        throw error;
      }
    }
  }

  async testConnection(): Promise<ZendeskConnectionTest> {
    const fallbackChecks: Array<{ path: string; parse: (value: unknown) => boolean }> = [
      { path: '/api/v2/users/me.json', parse: (value) => Boolean((value as { user?: unknown })?.user) },
      { path: '/api/v2/help_center/articles/count.json', parse: (value) => typeof (value as { count?: unknown }).count === 'number' }
    ];

    let lastError: unknown;
    for (const check of fallbackChecks) {
      try {
        const result = await this.requestWithRetry<unknown>(check.path, { params: { per_page: 1 } });
        if (check.parse(result)) {
          return { ok: true, status: 200 };
        }
      } catch (error) {
        lastError = error;
        if (error instanceof ZendeskApiError && error.status === 404) {
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  }

  async listCategories(locale: string): Promise<ZendeskCategory[]> {
    const all: ZendeskCategory[] = [];
    let nextPage: string | null = `/api/v2/help_center/${encodeURIComponent(locale)}/categories.json`;
    while (nextPage) {
      const data: CategoryData = await this.requestWithRetry<ZendeskCategoryResponse>(nextPage, { params: { per_page: 100 } });
      all.push(...(data.categories ?? []));
      const next = data.next_page;
      if (typeof next === 'string' && next) {
        const parsed = new URL(next);
        nextPage = `${parsed.pathname}${parsed.search}`;
      } else {
        nextPage = null;
      }
    }
    return all;
  }

  async listSections(categoryId: number, locale: string): Promise<ZendeskSection[]> {
    const all: ZendeskSection[] = [];
    let nextPage: string | null = `/api/v2/help_center/${encodeURIComponent(locale)}/categories/${categoryId}/sections.json`;
    while (nextPage) {
      const data: SectionData = await this.requestWithRetry<ZendeskSectionResponse>(nextPage, { params: { per_page: 100 } });
      all.push(...(data.sections ?? []));
      const next = data.next_page;
      if (typeof next === 'string' && next) {
        const parsed = new URL(next);
        nextPage = `${parsed.pathname}${parsed.search}`;
      } else {
        nextPage = null;
      }
    }
    return all;
  }

  async listArticles(
    locale: string,
    page = 1,
    since?: string
  ): Promise<{ items: ZendeskArticle[]; hasMore: boolean; nextPage?: string }> {
    const data = await this.requestWithRetry<ZendeskArticleResponse>(
      `/api/v2/help_center/${encodeURIComponent(locale)}/articles.json`,
      { params: { per_page: 100, page } }
    );

    const items = since ? data.articles.filter((article) => (article.updated_at ? article.updated_at > since : true)) : data.articles;
    return {
      items,
      hasMore: Boolean(data.next_page),
      nextPage: data.next_page ?? undefined
    };
  }

  async searchArticles(locale: string, query: string): Promise<ZendeskArticle[]> {
    const data = await this.requestWithRetry<ZendeskArticleResponse>('/api/v2/help_center/search.json', {
      params: {
        per_page: 100,
        page: 1,
        query: `type:article locale:${locale} ${query}`
      }
    });
    return data.articles ?? [];
  }

  async listEnabledLocales(): Promise<ZendeskHelpCenterLocale[]> {
    const locales = await this.requestWithRetry<ZendeskHelpCenterLocaleResponse>(
      '/api/v2/help_center/locales.json',
      { params: { per_page: 100 } }
    );
    return locales.locales ?? [];
  }

  async showArticle(articleId: number, locale?: string): Promise<ZendeskArticle> {
    const path = locale?.trim()
      ? `/api/v2/help_center/${encodeURIComponent(locale.trim())}/articles/${articleId}.json`
      : `/api/v2/help_center/articles/${articleId}.json`;
    const response = await this.requestWithRetry<ZendeskSingleArticleResponse>(path);
    return response.article;
  }

  async listTranslations(articleId: number): Promise<ZendeskTranslation[]> {
    const response = await this.requestWithRetry<ZendeskTranslationsResponse>(
      `/api/v2/help_center/articles/${articleId}/translations.json`
    );
    return response.translations ?? [];
  }

  async listMissingTranslations(articleId: number): Promise<string[]> {
    const [locales, translations] = await Promise.all([
      this.listEnabledLocales(),
      this.listTranslations(articleId)
    ]);
    const translated = new Set(translations.map((translation) => translation.locale.toLowerCase()));
    return locales
      .map((locale) => locale.locale)
      .filter((locale): locale is string => Boolean(locale))
      .filter((locale) => !translated.has(locale.toLowerCase()));
  }

  async createArticleInSection(sectionId: number, article: ZendeskArticleCreatePayload): Promise<ZendeskArticle> {
    return this.createArticleInSectionWithOptions(sectionId, article);
  }

  async createArticleInSectionWithOptions(
    sectionId: number,
    article: ZendeskArticleCreatePayload,
    options?: { notifySubscribers?: boolean }
  ): Promise<ZendeskArticle> {
    const response = await this.requestWithRetry<ZendeskSingleArticleResponse>(
      `/api/v2/help_center/sections/${sectionId}/articles.json`,
      {
        method: 'POST',
        body: {
          article,
          notify_subscribers: options?.notifySubscribers
        }
      }
    );
    return response.article;
  }

  async updateArticleMetadata(articleId: number, article: ZendeskArticleUpdatePayload): Promise<ZendeskArticle> {
    return this.updateArticleMetadataWithOptions(articleId, article);
  }

  async updateArticleMetadataWithOptions(
    articleId: number,
    article: ZendeskArticleUpdatePayload,
    options?: { notifySubscribers?: boolean }
  ): Promise<ZendeskArticle> {
    const response = await this.requestWithRetry<ZendeskSingleArticleResponse>(
      `/api/v2/help_center/articles/${articleId}.json`,
      {
        method: 'PUT',
        body: {
          article,
          notify_subscribers: options?.notifySubscribers
        }
      }
    );
    return response.article;
  }

  async createTranslation(articleId: number, translation: ZendeskTranslationPayload): Promise<ZendeskTranslation> {
    const response = await this.requestWithRetry<ZendeskTranslationResponse>(
      `/api/v2/help_center/articles/${articleId}/translations.json`,
      {
        method: 'POST',
        body: {
          translation
        }
      }
    );
    return response.translation;
  }

  async updateTranslation(articleId: number, locale: string, translation: ZendeskTranslationPayload): Promise<ZendeskTranslation> {
    const normalizedLocale = locale.trim();
    const response = await this.requestWithRetry<ZendeskTranslationResponse>(
      `/api/v2/help_center/articles/${articleId}/translations/${encodeURIComponent(normalizedLocale)}.json`,
      {
        method: 'PUT',
        body: {
          translation
        }
      }
    );
    return response.translation;
  }

  async upsertTranslation(articleId: number, translation: ZendeskTranslationPayload): Promise<ZendeskTranslation> {
    const normalizedLocale = translation.locale.trim().toLowerCase();
    const existing = await this.listTranslations(articleId);
    const match = existing.find((item) => item.locale.trim().toLowerCase() === normalizedLocale);
    if (match) {
      return this.updateTranslation(articleId, translation.locale, translation);
    }
    return this.createTranslation(articleId, translation);
  }

  async createCategory(locale: string, category: ZendeskCategoryPayload): Promise<ZendeskCategory> {
    const path = locale?.trim()
      ? `/api/v2/help_center/${encodeURIComponent(locale.trim())}/categories.json`
      : '/api/v2/help_center/categories.json';
    const response = await this.requestWithRetry<{ category: ZendeskCategory }>(path, {
      method: 'POST',
      body: {
        category
      }
    });
    return response.category;
  }

  async createSection(categoryId: number, locale: string, section: ZendeskSectionPayload): Promise<ZendeskSection> {
    const path = locale?.trim()
      ? `/api/v2/help_center/${encodeURIComponent(locale.trim())}/categories/${categoryId}/sections.json`
      : `/api/v2/help_center/categories/${categoryId}/sections.json`;
    const response = await this.requestWithRetry<{ section: ZendeskSection }>(path, {
      method: 'POST',
      body: {
        section
      }
    });
    return response.section;
  }

  async createGuideMediaUploadUrl(contentType: string, fileSize: number): Promise<ZendeskGuideMediaUploadUrlResponse> {
    return this.requestWithRetry<ZendeskGuideMediaUploadUrlResponse>('/api/v2/guide/medias/upload_url', {
      method: 'POST',
      body: {
        content_type: contentType,
        file_size: fileSize
      }
    });
  }

  async uploadGuideMedia(uploadUrl: string, headers: Record<string, string>, body: BodyInit): Promise<void> {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers,
      body
    });
    if (!response.ok) {
      const responseBody = await response.text().catch(() => '');
      throw new ZendeskApiError(
        `Zendesk media upload failed: ${response.status} ${response.statusText}`,
        response.status,
        responseBody
      );
    }
  }

  async createGuideMedia(assetUploadId: string, filename: string): Promise<ZendeskGuideMedia> {
    const response = await this.requestWithRetry<ZendeskGuideMediaResponse>('/api/v2/guide/medias', {
      method: 'POST',
      body: {
        asset_upload_id: assetUploadId,
        filename
      }
    });
    return response.media;
  }

  async archiveArticle(articleId: number, locale: string): Promise<void> {
    await this.requestWithRetry<void>(
      `/api/v2/help_center/${encodeURIComponent(locale.trim())}/articles/${articleId}.json`,
      {
        method: 'DELETE'
      }
    );
  }
}
