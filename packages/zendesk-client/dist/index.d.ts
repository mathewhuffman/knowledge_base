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
export declare class ZendeskApiError extends Error {
    status: number;
    responseBody?: string;
    constructor(message: string, status: number, responseBody?: string);
    get isRateLimitError(): boolean;
}
interface InternalConfig extends ZendeskClientConfig {
    credentials: ZendeskCredentials;
}
export declare class ZendeskClient {
    private readonly baseHost;
    private readonly timeoutMs;
    private readonly credentials;
    constructor(config: InternalConfig);
    isConfigured(): boolean;
    static fromConfig(config: ZendeskClientConfig, credentials: ZendeskCredentials): ZendeskClient;
    private getAuthHeader;
    private request;
    private requestWithRetry;
    testConnection(): Promise<ZendeskConnectionTest>;
    listCategories(locale: string): Promise<ZendeskCategory[]>;
    listSections(categoryId: number, locale: string): Promise<ZendeskSection[]>;
    listArticles(locale: string, page?: number, since?: string): Promise<{
        items: ZendeskArticle[];
        hasMore: boolean;
        nextPage?: string;
    }>;
    searchArticles(locale: string, query: string): Promise<ZendeskArticle[]>;
}
export {};
