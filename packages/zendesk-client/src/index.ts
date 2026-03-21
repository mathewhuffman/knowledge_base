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

  private async request<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
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
      throw new ZendeskApiError(
        `Zendesk API error for ${path}: ${response.status} ${response.statusText}`,
        response.status,
        responseBody
      );
    }

    return (await response.json()) as T;
  }

  private async requestWithRetry<T>(path: string, params?: Record<string, string | number>, attempts = 3): Promise<T> {
    const payload = params ?? {};
    let attempt = 0;
    while (true) {
      try {
        return await this.request<T>(path, payload);
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
        const result = await this.requestWithRetry<unknown>(check.path, { per_page: 1 });
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
      const data: CategoryData = await this.requestWithRetry<ZendeskCategoryResponse>(nextPage, { per_page: 100 });
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
      const data: SectionData = await this.requestWithRetry<ZendeskSectionResponse>(nextPage, { per_page: 100 });
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
      { per_page: 100, page }
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
      per_page: 100,
      page: 1,
      query: `type:article locale:${locale} ${query}`
    });
    return data.articles ?? [];
  }
}
