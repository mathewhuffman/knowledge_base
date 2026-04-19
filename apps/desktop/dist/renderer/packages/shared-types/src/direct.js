export const DIRECT_READ_ACTION_TYPES = [
    'search_kb',
    'get_batch_context',
    'get_pbi',
    'get_pbi_subset',
    'get_article',
    'get_article_family',
    'get_locale_variant',
    'get_article_history',
    'find_related_articles',
    'list_categories',
    'list_sections',
    'list_article_templates',
    'get_template'
];
export const DIRECT_MUTATION_ACTION_TYPES = [
    'record_agent_notes',
    'create_proposals',
    'patch_form'
];
export const DIRECT_ACTION_TYPES = [
    ...DIRECT_READ_ACTION_TYPES,
    ...DIRECT_MUTATION_ACTION_TYPES
];
export const DIRECT_BATCH_READ_ONLY_ACTION_TYPES = DIRECT_READ_ACTION_TYPES;
export const DIRECT_BATCH_WORKER_ACTION_TYPES = [
    ...DIRECT_READ_ACTION_TYPES,
    'create_proposals'
];
export const DIRECT_ARTICLE_EDIT_ACTION_TYPES = DIRECT_READ_ACTION_TYPES;
export const DIRECT_ASSISTANT_READ_ACTION_TYPES = DIRECT_READ_ACTION_TYPES;
export const DIRECT_ASSISTANT_TEMPLATE_ACTION_TYPES = [
    ...DIRECT_READ_ACTION_TYPES,
    'patch_form'
];
