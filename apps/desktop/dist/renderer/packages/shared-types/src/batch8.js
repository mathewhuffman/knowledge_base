export var DraftBranchStatus;
(function (DraftBranchStatus) {
    DraftBranchStatus["ACTIVE"] = "active";
    DraftBranchStatus["READY_TO_PUBLISH"] = "ready_to_publish";
    DraftBranchStatus["CONFLICTED"] = "conflicted";
    DraftBranchStatus["PUBLISHED"] = "published";
    DraftBranchStatus["OBSOLETE"] = "obsolete";
    DraftBranchStatus["DISCARDED"] = "discarded";
})(DraftBranchStatus || (DraftBranchStatus = {}));
export var DraftValidationSeverity;
(function (DraftValidationSeverity) {
    DraftValidationSeverity["INFO"] = "info";
    DraftValidationSeverity["WARNING"] = "warning";
    DraftValidationSeverity["ERROR"] = "error";
})(DraftValidationSeverity || (DraftValidationSeverity = {}));
export var DraftValidationCode;
(function (DraftValidationCode) {
    DraftValidationCode["INVALID_HTML"] = "invalid_html";
    DraftValidationCode["UNSUPPORTED_TAG"] = "unsupported_tag";
    DraftValidationCode["UNRESOLVED_PLACEHOLDER"] = "unresolved_placeholder";
    DraftValidationCode["MISSING_PLACEMENT"] = "missing_placement";
    DraftValidationCode["LOCALE_ISSUE"] = "locale_issue";
})(DraftValidationCode || (DraftValidationCode = {}));
export var DraftCommitSource;
(function (DraftCommitSource) {
    DraftCommitSource["PROPOSAL"] = "proposal";
    DraftCommitSource["MANUAL"] = "manual";
    DraftCommitSource["AUTOSAVE"] = "autosave";
    DraftCommitSource["SYSTEM"] = "system";
})(DraftCommitSource || (DraftCommitSource = {}));
