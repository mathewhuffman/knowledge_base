"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublishStatus = exports.PBIValidationStatus = exports.PBIImportFormat = exports.PBIBatchScopeMode = exports.PBIBatchStatus = exports.ProposalDecision = exports.ProposalAction = exports.RevisionStatus = exports.RevisionState = exports.WorkspaceState = void 0;
var WorkspaceState;
(function (WorkspaceState) {
    WorkspaceState["ACTIVE"] = "active";
    WorkspaceState["INACTIVE"] = "inactive";
    WorkspaceState["CONFLICTED"] = "conflicted";
})(WorkspaceState || (exports.WorkspaceState = WorkspaceState = {}));
var RevisionState;
(function (RevisionState) {
    RevisionState["LIVE"] = "live";
    RevisionState["DRAFT_BRANCH"] = "draft_branch";
    RevisionState["OBSOLETE"] = "obsolete";
    RevisionState["RETIRED"] = "retired";
})(RevisionState || (exports.RevisionState = RevisionState = {}));
var RevisionStatus;
(function (RevisionStatus) {
    RevisionStatus["OPEN"] = "open";
    RevisionStatus["PROMOTED"] = "promoted";
    RevisionStatus["FAILED"] = "failed";
    RevisionStatus["DELETED"] = "deleted";
})(RevisionStatus || (exports.RevisionStatus = RevisionStatus = {}));
var ProposalAction;
(function (ProposalAction) {
    ProposalAction["CREATE"] = "create";
    ProposalAction["EDIT"] = "edit";
    ProposalAction["RETIRE"] = "retire";
    ProposalAction["NO_IMPACT"] = "no_impact";
})(ProposalAction || (exports.ProposalAction = ProposalAction = {}));
var ProposalDecision;
(function (ProposalDecision) {
    ProposalDecision["ACCEPT"] = "accept";
    ProposalDecision["DENY"] = "deny";
    ProposalDecision["DEFER"] = "defer";
    ProposalDecision["APPLY_TO_BRANCH"] = "apply_to_branch";
    ProposalDecision["CREATE_BRANCH"] = "create_branch";
})(ProposalDecision || (exports.ProposalDecision = ProposalDecision = {}));
var PBIBatchStatus;
(function (PBIBatchStatus) {
    PBIBatchStatus["IMPORTED"] = "imported";
    PBIBatchStatus["SCOPED"] = "scoped";
    PBIBatchStatus["SUBMITTED"] = "submitted";
    PBIBatchStatus["ANALYZED"] = "analyzed";
    PBIBatchStatus["REVIEW_IN_PROGRESS"] = "review_in_progress";
    PBIBatchStatus["REVIEW_COMPLETE"] = "review_complete";
    PBIBatchStatus["ARCHIVED"] = "archived";
})(PBIBatchStatus || (exports.PBIBatchStatus = PBIBatchStatus = {}));
var PBIBatchScopeMode;
(function (PBIBatchScopeMode) {
    PBIBatchScopeMode["ALL"] = "all";
    PBIBatchScopeMode["ALL_EXCEPT_SELECTED"] = "all_except_selected";
    PBIBatchScopeMode["SELECTED_ONLY"] = "selected_only";
})(PBIBatchScopeMode || (exports.PBIBatchScopeMode = PBIBatchScopeMode = {}));
var PBIImportFormat;
(function (PBIImportFormat) {
    PBIImportFormat["CSV"] = "csv";
    PBIImportFormat["HTML"] = "html";
})(PBIImportFormat || (exports.PBIImportFormat = PBIImportFormat = {}));
var PBIValidationStatus;
(function (PBIValidationStatus) {
    PBIValidationStatus["CANDIDATE"] = "candidate";
    PBIValidationStatus["MALFORMED"] = "malformed";
    PBIValidationStatus["DUPLICATE"] = "duplicate";
    PBIValidationStatus["IGNORED"] = "ignored";
})(PBIValidationStatus || (exports.PBIValidationStatus = PBIValidationStatus = {}));
var PublishStatus;
(function (PublishStatus) {
    PublishStatus["QUEUED"] = "queued";
    PublishStatus["RUNNING"] = "running";
    PublishStatus["COMPLETED"] = "completed";
    PublishStatus["FAILED"] = "failed";
    PublishStatus["CANCELED"] = "canceled";
})(PublishStatus || (exports.PublishStatus = PublishStatus = {}));
