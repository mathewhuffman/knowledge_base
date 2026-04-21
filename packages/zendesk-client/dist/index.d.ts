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
    listEnabledLocales(): Promise<ZendeskHelpCenterLocale[]>;
    showArticle(articleId: number, locale?: string): Promise<ZendeskArticle>;
    listTranslations(articleId: number): Promise<ZendeskTranslation[]>;
    listMissingTranslations(articleId: number): Promise<string[]>;
    createArticleInSection(sectionId: number, article: ZendeskArticleCreatePayload): Promise<ZendeskArticle>;
    createArticleInSectionWithOptions(sectionId: number, article: ZendeskArticleCreatePayload, options?: {
        notifySubscribers?: boolean;
    }): Promise<ZendeskArticle>;
    updateArticleMetadata(articleId: number, article: ZendeskArticleUpdatePayload): Promise<ZendeskArticle>;
    updateArticleMetadataWithOptions(articleId: number, article: ZendeskArticleUpdatePayload, options?: {
        notifySubscribers?: boolean;
    }): Promise<ZendeskArticle>;
    createTranslation(articleId: number, translation: ZendeskTranslationPayload): Promise<ZendeskTranslation>;
    updateTranslation(articleId: number, locale: string, translation: ZendeskTranslationPayload): Promise<ZendeskTranslation>;
    upsertTranslation(articleId: number, translation: ZendeskTranslationPayload): Promise<ZendeskTranslation>;
    createCategory(locale: string, category: ZendeskCategoryPayload): Promise<ZendeskCategory>;
    createSection(categoryId: number, locale: string, section: ZendeskSectionPayload): Promise<ZendeskSection>;
    createGuideMediaUploadUrl(contentType: string, fileSize: number): Promise<ZendeskGuideMediaUploadUrlResponse>;
    uploadGuideMedia(uploadUrl: string, headers: Record<string, string>, body: BodyInit): Promise<void>;
    createGuideMedia(assetUploadId: string, filename: string): Promise<ZendeskGuideMedia>;
    archiveArticle(articleId: number, locale: string): Promise<void>;
}
export {};
