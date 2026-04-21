"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProposalReviewDecision = exports.ProposalReviewStatus = void 0;
var ProposalReviewStatus;
(function (ProposalReviewStatus) {
    ProposalReviewStatus["STAGED_ANALYSIS"] = "staged_analysis";
    ProposalReviewStatus["PENDING_REVIEW"] = "pending_review";
    ProposalReviewStatus["ACCEPTED"] = "accepted";
    ProposalReviewStatus["DENIED"] = "denied";
    ProposalReviewStatus["DEFERRED"] = "deferred";
    ProposalReviewStatus["APPLIED_TO_BRANCH"] = "applied_to_branch";
    ProposalReviewStatus["ARCHIVED"] = "archived";
})(ProposalReviewStatus || (exports.ProposalReviewStatus = ProposalReviewStatus = {}));
var ProposalReviewDecision;
(function (ProposalReviewDecision) {
    ProposalReviewDecision["ACCEPT"] = "accept";
    ProposalReviewDecision["DENY"] = "deny";
    ProposalReviewDecision["DEFER"] = "defer";
    ProposalReviewDecision["APPLY_TO_BRANCH"] = "apply_to_branch";
    ProposalReviewDecision["ARCHIVE"] = "archive";
})(ProposalReviewDecision || (exports.ProposalReviewDecision = ProposalReviewDecision = {}));
