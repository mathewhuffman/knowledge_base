"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_WORKSPACE_ROOT = void 0;
exports.resolveAppWorkspaceRoot = resolveAppWorkspaceRoot;
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
exports.DEFAULT_WORKSPACE_ROOT = node_path_1.default.join(node_os_1.default.homedir(), 'kb-vault-workspaces');
function resolveAppWorkspaceRoot(override, config) {
    return override || process.env.KB_VAULT_WORKSPACE_ROOT || config?.workspaces?.defaultRoot || exports.DEFAULT_WORKSPACE_ROOT;
}
