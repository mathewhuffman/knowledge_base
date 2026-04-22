import { type CursorAcpRuntime } from '@kb-vault/agent-runtime';
import type { AgentHealthCheckResponse, KbAccessHealth, KbAccessMode } from '@kb-vault/shared-types';

export interface KbAccessModeSelection {
  requestedMode?: KbAccessMode;
  workspaceMode: KbAccessMode;
  selectedMode: KbAccessMode;
}

export interface HealthyKbAccessModeSelection extends KbAccessModeSelection {
  health: AgentHealthCheckResponse;
  selectedProvider: KbAccessHealth;
}

interface ResolveKbAccessModeSelectionInput {
  workspaceId: string;
  requestedMode?: KbAccessMode;
  resolveWorkspaceKbAccessMode: (workspaceId: string) => Promise<KbAccessMode>;
  agentRuntime: Pick<CursorAcpRuntime, 'checkHealth'>;
}

export class KbAccessModePreflightError extends Error {
  readonly name = 'KbAccessModePreflightError';

  constructor(public readonly selection: HealthyKbAccessModeSelection) {
    super(buildKbAccessModePreflightFailureMessage(selection.selectedMode, selection.selectedProvider));
  }
}

export function selectKbAccessMode(requestedMode: KbAccessMode | undefined, workspaceMode: KbAccessMode): KbAccessMode {
  return requestedMode ?? workspaceMode;
}

export function buildKbAccessModePreflightFailureMessage(
  selectedMode: KbAccessMode,
  selectedProvider: Pick<KbAccessHealth, 'message'>
): string {
  return `Selected KB access mode ${selectedMode.toUpperCase()} is not ready: ${selectedProvider.message || 'not ready'}. KnowledgeBase will not switch providers automatically.`;
}

export async function resolveKbAccessModeSelection(
  input: ResolveKbAccessModeSelectionInput
): Promise<HealthyKbAccessModeSelection> {
  const workspaceMode = await input.resolveWorkspaceKbAccessMode(input.workspaceId);
  const selectedMode = selectKbAccessMode(input.requestedMode, workspaceMode);
  const health = await input.agentRuntime.checkHealth(input.workspaceId, selectedMode, workspaceMode);

  return {
    requestedMode: input.requestedMode,
    workspaceMode,
    selectedMode,
    health,
    selectedProvider: health.providers[selectedMode]
  };
}

export async function requireHealthyKbAccessModeSelection(
  input: ResolveKbAccessModeSelectionInput
): Promise<HealthyKbAccessModeSelection> {
  const selection = await resolveKbAccessModeSelection(input);
  if (!selection.selectedProvider.ok) {
    throw new KbAccessModePreflightError(selection);
  }
  return selection;
}
