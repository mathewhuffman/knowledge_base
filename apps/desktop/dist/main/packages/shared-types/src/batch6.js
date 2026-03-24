"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CliHealthFailure = exports.AgentCommand = void 0;
var AgentCommand;
(function (AgentCommand) {
    AgentCommand["ANALYSIS_RUN"] = "agent.analysis.run";
    AgentCommand["ARTICLE_EDIT_RUN"] = "agent.article_edit.run";
})(AgentCommand || (exports.AgentCommand = AgentCommand = {}));
var CliHealthFailure;
(function (CliHealthFailure) {
    CliHealthFailure["BINARY_NOT_FOUND"] = "binary_not_found";
    CliHealthFailure["BINARY_NOT_EXECUTABLE"] = "binary_not_executable";
    CliHealthFailure["LOOPBACK_NOT_RUNNING"] = "loopback_not_running";
    CliHealthFailure["LOOPBACK_UNREACHABLE"] = "loopback_unreachable";
    CliHealthFailure["LOOPBACK_UNHEALTHY"] = "loopback_unhealthy";
    CliHealthFailure["AUTH_TOKEN_MISSING"] = "auth_token_missing";
    CliHealthFailure["HEALTH_PROBE_TIMEOUT"] = "health_probe_timeout";
    CliHealthFailure["HEALTH_PROBE_FAILED"] = "health_probe_failed";
    CliHealthFailure["HEALTH_PROBE_REJECTED"] = "health_probe_rejected";
})(CliHealthFailure || (exports.CliHealthFailure = CliHealthFailure = {}));
