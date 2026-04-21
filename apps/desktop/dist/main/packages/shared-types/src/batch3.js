"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublishJobItemState = exports.ZendeskPublishValidationCode = void 0;
var ZendeskPublishValidationCode;
(function (ZendeskPublishValidationCode) {
    ZendeskPublishValidationCode["BRANCH_NOT_READY"] = "branch_not_ready";
    ZendeskPublishValidationCode["DRAFT_VALIDATION"] = "draft_validation";
    ZendeskPublishValidationCode["PLACEHOLDER_BLOCKED"] = "placeholder_blocked";
    ZendeskPublishValidationCode["MISSING_PLACEMENT"] = "missing_placement";
    ZendeskPublishValidationCode["LOCALE_DISABLED"] = "locale_disabled";
    ZendeskPublishValidationCode["ZENDESK_CONFIGURATION"] = "zendesk_configuration";
    ZendeskPublishValidationCode["REMOTE_ARTICLE_MISSING"] = "remote_article_missing";
    ZendeskPublishValidationCode["REMOTE_LOCALE_DISABLED"] = "remote_locale_disabled";
    ZendeskPublishValidationCode["REMOTE_CONFLICT"] = "remote_conflict";
})(ZendeskPublishValidationCode || (exports.ZendeskPublishValidationCode = ZendeskPublishValidationCode = {}));
var PublishJobItemState;
(function (PublishJobItemState) {
    PublishJobItemState["QUEUED"] = "queued";
    PublishJobItemState["RUNNING"] = "running";
    PublishJobItemState["SUCCEEDED"] = "succeeded";
    PublishJobItemState["FAILED"] = "failed";
    PublishJobItemState["BLOCKED"] = "blocked";
    PublishJobItemState["CONFLICTED"] = "conflicted";
    PublishJobItemState["CANCELED"] = "canceled";
})(PublishJobItemState || (exports.PublishJobItemState = PublishJobItemState = {}));
