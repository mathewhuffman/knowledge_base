import os from 'node:os';
import path from 'node:path';
import { AppConfig } from './types';

export const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), 'kb-vault-workspaces');

export function resolveAppWorkspaceRoot(override?: string, config?: AppConfig): string {
  return override || process.env.KB_VAULT_WORKSPACE_ROOT || config?.workspaces?.defaultRoot || DEFAULT_WORKSPACE_ROOT;
}
