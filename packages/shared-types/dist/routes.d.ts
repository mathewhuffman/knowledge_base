export declare enum AppRoute {
    WORKSPACE_SWITCHER = "workspace_switcher",
    KB_VAULT_HOME = "kb_vault_home",
    ARTICLE_EXPLORER = "article_explorer",
    PBI_BATCHES = "pbi_batches",
    PROPOSAL_REVIEW = "proposal_review",
    DRAFTS = "drafts",
    PUBLISH_QUEUE = "publish_queue",
    TEMPLATES_AND_PROMPTS = "templates_and_prompts",
    SETTINGS = "settings"
}
export interface RouteConfig {
    id: AppRoute;
    label: string;
    description: string;
}
