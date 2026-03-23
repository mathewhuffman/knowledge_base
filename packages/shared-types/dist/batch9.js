"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemplatePackType = exports.ArticleAiSessionStatus = exports.ArticleAiPresetAction = exports.ArticleAiMessageKind = exports.ArticleAiMessageRole = void 0;
var ArticleAiMessageRole;
(function (ArticleAiMessageRole) {
    ArticleAiMessageRole["SYSTEM"] = "system";
    ArticleAiMessageRole["USER"] = "user";
    ArticleAiMessageRole["ASSISTANT"] = "assistant";
})(ArticleAiMessageRole || (exports.ArticleAiMessageRole = ArticleAiMessageRole = {}));
var ArticleAiMessageKind;
(function (ArticleAiMessageKind) {
    ArticleAiMessageKind["CHAT"] = "chat";
    ArticleAiMessageKind["EDIT_RESULT"] = "edit_result";
    ArticleAiMessageKind["DECISION"] = "decision";
})(ArticleAiMessageKind || (exports.ArticleAiMessageKind = ArticleAiMessageKind = {}));
var ArticleAiPresetAction;
(function (ArticleAiPresetAction) {
    ArticleAiPresetAction["REWRITE_TONE"] = "rewrite_tone";
    ArticleAiPresetAction["SHORTEN"] = "shorten";
    ArticleAiPresetAction["EXPAND"] = "expand";
    ArticleAiPresetAction["RESTRUCTURE"] = "restructure";
    ArticleAiPresetAction["CONVERT_TO_TROUBLESHOOTING"] = "convert_to_troubleshooting";
    ArticleAiPresetAction["ALIGN_TO_TEMPLATE"] = "align_to_template";
    ArticleAiPresetAction["UPDATE_LOCALE"] = "update_locale";
    ArticleAiPresetAction["INSERT_IMAGE_PLACEHOLDERS"] = "insert_image_placeholders";
    ArticleAiPresetAction["FREEFORM"] = "freeform";
})(ArticleAiPresetAction || (exports.ArticleAiPresetAction = ArticleAiPresetAction = {}));
var ArticleAiSessionStatus;
(function (ArticleAiSessionStatus) {
    ArticleAiSessionStatus["IDLE"] = "idle";
    ArticleAiSessionStatus["RUNNING"] = "running";
    ArticleAiSessionStatus["HAS_PENDING_EDIT"] = "has_pending_edit";
})(ArticleAiSessionStatus || (exports.ArticleAiSessionStatus = ArticleAiSessionStatus = {}));
var TemplatePackType;
(function (TemplatePackType) {
    TemplatePackType["STANDARD_HOW_TO"] = "standard_how_to";
    TemplatePackType["FAQ"] = "faq";
    TemplatePackType["TROUBLESHOOTING"] = "troubleshooting";
    TemplatePackType["POLICY_NOTICE"] = "policy_notice";
    TemplatePackType["FEATURE_OVERVIEW"] = "feature_overview";
})(TemplatePackType || (exports.TemplatePackType = TemplatePackType = {}));
