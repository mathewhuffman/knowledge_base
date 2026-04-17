export var WorkspaceState;
(function (WorkspaceState) {
    WorkspaceState["ACTIVE"] = "active";
    WorkspaceState["INACTIVE"] = "inactive";
    WorkspaceState["CONFLICTED"] = "conflicted";
})(WorkspaceState || (WorkspaceState = {}));
export var RevisionState;
(function (RevisionState) {
    RevisionState["LIVE"] = "live";
    RevisionState["DRAFT_BRANCH"] = "draft_branch";
    RevisionState["OBSOLETE"] = "obsolete";
    RevisionState["RETIRED"] = "retired";
})(RevisionState || (RevisionState = {}));
export var RevisionStatus;
(function (RevisionStatus) {
    RevisionStatus["OPEN"] = "open";
    RevisionStatus["PROMOTED"] = "promoted";
    RevisionStatus["FAILED"] = "failed";
    RevisionStatus["DELETED"] = "deleted";
})(RevisionStatus || (RevisionStatus = {}));
export var ProposalAction;
(function (ProposalAction) {
    ProposalAction["CREATE"] = "create";
    ProposalAction["EDIT"] = "edit";
    ProposalAction["RETIRE"] = "retire";
    ProposalAction["NO_IMPACT"] = "no_impact";
})(ProposalAction || (ProposalAction = {}));
export var ProposalDecision;
(function (ProposalDecision) {
    ProposalDecision["ACCEPT"] = "accept";
    ProposalDecision["DENY"] = "deny";
    ProposalDecision["DEFER"] = "defer";
    ProposalDecision["APPLY_TO_BRANCH"] = "apply_to_branch";
    ProposalDecision["CREATE_BRANCH"] = "create_branch";
})(ProposalDecision || (ProposalDecision = {}));
export var PBIBatchStatus;
(function (PBIBatchStatus) {
    PBIBatchStatus["IMPORTED"] = "imported";
    PBIBatchStatus["SCOPED"] = "scoped";
    PBIBatchStatus["SUBMITTED"] = "submitted";
    PBIBatchStatus["ANALYZED"] = "analyzed";
    PBIBatchStatus["REVIEW_IN_PROGRESS"] = "review_in_progress";
    PBIBatchStatus["REVIEW_COMPLETE"] = "review_complete";
    PBIBatchStatus["ARCHIVED"] = "archived";
})(PBIBatchStatus || (PBIBatchStatus = {}));
export var PBIBatchScopeMode;
(function (PBIBatchScopeMode) {
    PBIBatchScopeMode["ALL"] = "all";
    PBIBatchScopeMode["ALL_EXCEPT_SELECTED"] = "all_except_selected";
    PBIBatchScopeMode["SELECTED_ONLY"] = "selected_only";
})(PBIBatchScopeMode || (PBIBatchScopeMode = {}));
export var PBIImportFormat;
(function (PBIImportFormat) {
    PBIImportFormat["CSV"] = "csv";
    PBIImportFormat["HTML"] = "html";
})(PBIImportFormat || (PBIImportFormat = {}));
export var PBIValidationStatus;
(function (PBIValidationStatus) {
    PBIValidationStatus["CANDIDATE"] = "candidate";
    PBIValidationStatus["MALFORMED"] = "malformed";
    PBIValidationStatus["DUPLICATE"] = "duplicate";
    PBIValidationStatus["IGNORED"] = "ignored";
})(PBIValidationStatus || (PBIValidationStatus = {}));
export var PublishStatus;
(function (PublishStatus) {
    PublishStatus["QUEUED"] = "queued";
    PublishStatus["RUNNING"] = "running";
    PublishStatus["COMPLETED"] = "completed";
    PublishStatus["FAILED"] = "failed";
    PublishStatus["CANCELED"] = "canceled";
})(PublishStatus || (PublishStatus = {}));
export var ArticleRelationType;
(function (ArticleRelationType) {
    ArticleRelationType["SAME_WORKFLOW"] = "same_workflow";
    ArticleRelationType["PREREQUISITE"] = "prerequisite";
    ArticleRelationType["FOLLOW_UP"] = "follow_up";
    ArticleRelationType["PARENT_TOPIC"] = "parent_topic";
    ArticleRelationType["CHILD_TOPIC"] = "child_topic";
    ArticleRelationType["SHARED_SURFACE"] = "shared_surface";
    ArticleRelationType["REPLACES"] = "replaces";
    ArticleRelationType["SEE_ALSO"] = "see_also";
})(ArticleRelationType || (ArticleRelationType = {}));
export var ArticleRelationDirection;
(function (ArticleRelationDirection) {
    ArticleRelationDirection["BIDIRECTIONAL"] = "bidirectional";
    ArticleRelationDirection["LEFT_TO_RIGHT"] = "left_to_right";
    ArticleRelationDirection["RIGHT_TO_LEFT"] = "right_to_left";
})(ArticleRelationDirection || (ArticleRelationDirection = {}));
export var ArticleRelationOrigin;
(function (ArticleRelationOrigin) {
    ArticleRelationOrigin["INFERRED"] = "inferred";
    ArticleRelationOrigin["MANUAL"] = "manual";
})(ArticleRelationOrigin || (ArticleRelationOrigin = {}));
export var ArticleRelationStatus;
(function (ArticleRelationStatus) {
    ArticleRelationStatus["ACTIVE"] = "active";
    ArticleRelationStatus["SUPPRESSED"] = "suppressed";
})(ArticleRelationStatus || (ArticleRelationStatus = {}));
export var ArticleRelationEvidenceType;
(function (ArticleRelationEvidenceType) {
    ArticleRelationEvidenceType["TITLE_TOKEN"] = "title_token";
    ArticleRelationEvidenceType["SECTION_MATCH"] = "section_match";
    ArticleRelationEvidenceType["CATEGORY_MATCH"] = "category_match";
    ArticleRelationEvidenceType["CONTENT_TOKEN"] = "content_token";
    ArticleRelationEvidenceType["EXTERNAL_KEY"] = "external_key";
    ArticleRelationEvidenceType["PBI_LINK"] = "pbi_link";
    ArticleRelationEvidenceType["MANUAL_NOTE"] = "manual_note";
    ArticleRelationEvidenceType["HEURISTIC"] = "heuristic";
})(ArticleRelationEvidenceType || (ArticleRelationEvidenceType = {}));
