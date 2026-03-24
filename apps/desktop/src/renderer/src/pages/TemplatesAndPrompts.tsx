import { useEffect, useMemo, useState } from 'react';
import { TemplatePackType, type TemplatePackDetail, type TemplatePackListResponse } from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { IconPlus, IconLayout, IconZap, IconTrash2, IconCheckCircle } from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc, useIpcMutation } from '../hooks/useIpc';
import { useRegisterAiAssistantView } from '../components/assistant/AssistantContext';
import { AppRoute, type AiAssistantUiAction } from '@kb-vault/shared-types';

const TEMPLATE_TYPE_OPTIONS = [
  { value: TemplatePackType.STANDARD_HOW_TO, label: 'Standard How-To' },
  { value: TemplatePackType.FAQ, label: 'FAQ' },
  { value: TemplatePackType.TROUBLESHOOTING, label: 'Troubleshooting' },
  { value: TemplatePackType.POLICY_NOTICE, label: 'Policy / Notice' },
  { value: TemplatePackType.FEATURE_OVERVIEW, label: 'Feature Overview' },
];

function templateTypeLabel(type: TemplatePackType): string {
  return TEMPLATE_TYPE_OPTIONS.find(o => o.value === type)?.label ?? type.replace(/_/g, ' ');
}

function emptyForm(): Omit<TemplatePackDetail, 'id' | 'workspaceId' | 'updatedAtUtc' | 'active'> & { active: boolean } {
  return {
    name: '',
    language: 'en-us',
    templateType: TemplatePackType.STANDARD_HOW_TO,
    promptTemplate: '',
    toneRules: '',
    description: '',
    examples: '',
    active: true,
    analysisSummary: undefined,
    analysis: undefined,
  };
}

export const TemplatesAndPrompts = () => {
  const { activeWorkspace } = useWorkspace();
  const listQuery = useIpc<TemplatePackListResponse>('template.pack.list');
  const saveMutation = useIpcMutation<TemplatePackDetail>('template.pack.save');
  const deleteMutation = useIpcMutation<{ templatePackId: string }>('template.pack.delete');
  const analyzeMutation = useIpcMutation<TemplatePackDetail>('template.pack.analyze');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReturnType<typeof emptyForm>>(emptyForm());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    if (!activeWorkspace) return;
    void listQuery.execute({ workspaceId: activeWorkspace.id, includeInactive: true });
  }, [activeWorkspace]);

  useEffect(() => {
    const firstId = listQuery.data?.templates[0]?.id;
    if (!selectedId && firstId) {
      setSelectedId(firstId);
    }
  }, [listQuery.data, selectedId]);

  const templates: TemplatePackDetail[] = listQuery.data?.templates ?? [];
  const selected: TemplatePackDetail | null = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? null,
    [templates, selectedId]
  );

  useEffect(() => {
    if (selected) {
      setDraft({
        ...selected,
        description: selected.description ?? '',
        examples: selected.examples ?? '',
      });
    } else if (!selectedId) {
      setDraft(emptyForm());
    }
  }, [selected, selectedId]);

  const templateVersionToken = useMemo(
    () => `${selectedId ?? 'new'}:${selected?.updatedAtUtc ?? 'draft'}:${JSON.stringify(draft)}`,
    [draft, selected?.updatedAtUtc, selectedId]
  );

  useRegisterAiAssistantView({
    enabled: Boolean(activeWorkspace),
    context: {
      workspaceId: activeWorkspace?.id ?? '',
      route: AppRoute.TEMPLATES_AND_PROMPTS,
      routeLabel: 'Templates & Prompts',
      subject: {
        type: 'template_pack',
        id: selectedId ?? 'new-template',
        title: draft.name || selected?.name || 'Template Pack',
        locale: draft.language
      },
      workingState: {
        kind: 'template_pack',
        versionToken: templateVersionToken,
        payload: draft
      },
      capabilities: {
        canChat: true,
        canCreateProposal: false,
        canPatchProposal: false,
        canPatchDraft: false,
        canPatchTemplate: true,
        canUseUnsavedWorkingState: true
      },
      backingData: {
        selectedTemplateId: selectedId,
        templatePackId: selectedId,
        persistedTemplate: selected
      }
    },
    applyUiActions: (actions: AiAssistantUiAction[]) => {
      actions.forEach((action) => {
        if (action.type === 'replace_template_form') {
          setDraft((prev) => ({
            ...prev,
            ...action.payload,
            templateType: (action.payload.templateType as TemplatePackType | undefined) ?? prev.templateType
          }));
        }
      });
    }
  });

  const refresh = async () => {
    if (!activeWorkspace) return;
    await listQuery.execute({ workspaceId: activeWorkspace.id, includeInactive: true });
  };

  if (!activeWorkspace) {
    return (
      <>
        <PageHeader title="Templates & Prompts" subtitle="Open a workspace to manage article templates." />
        <div className="route-content">
          <EmptyState icon={<IconLayout size={40} />} title="No workspace selected" description="Choose a workspace to edit local template packs." />
        </div>
      </>
    );
  }

  const busy = saveMutation.loading || deleteMutation.loading || analyzeMutation.loading;
  const isNewTemplate = !selectedId;
  const canSave = draft.name.trim() && draft.promptTemplate.trim() && draft.toneRules.trim();

  return (
    <>
      <PageHeader
        title="Templates & Prompts"
        subtitle="Edit local template packs and prompt guidance for article AI"
        actions={(
          <button
            className="btn btn-primary"
            onClick={() => {
              setSelectedId(null);
              setDraft(emptyForm());
            }}
          >
            <IconPlus size={14} />
            New Template
          </button>
        )}
      />
      <div className="route-content" style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: 'var(--space-5)', alignItems: 'start' }}>
        {/* ---- Template list panel ---- */}
        <div className="panel template-list-panel" style={{ padding: 'var(--space-3)' }}>
          {listQuery.loading && !listQuery.data ? (
            <LoadingState message="Loading template packs..." />
          ) : listQuery.error && !listQuery.data ? (
            <ErrorState title="Unable to load templates" description={listQuery.error} />
          ) : templates.length === 0 ? (
            <EmptyState icon={<IconLayout size={32} />} title="No templates yet" description="Create your first local template pack." />
          ) : (
            templates.map((template) => (
              <button
                key={template.id}
                type="button"
                className={`template-card${template.id === selectedId ? ' selected' : ''}`}
                onClick={() => setSelectedId(template.id)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                  <span className="template-card-title">{template.name}</span>
                  <Badge variant={template.active ? 'success' : 'neutral'}>
                    {template.active ? 'active' : 'inactive'}
                  </Badge>
                </div>
                <div className="template-card-desc">
                  {template.description || 'No description yet.'}
                </div>
                <div className="template-card-tags">
                  <Badge variant="neutral">{template.language}</Badge>
                  <Badge variant="primary">{templateTypeLabel(template.templateType)}</Badge>
                </div>
                {template.analysisSummary && (
                  <div className="template-card-analysis">{template.analysisSummary}</div>
                )}
              </button>
            ))
          )}
        </div>

        {/* ---- Template editor panel ---- */}
        <div className="panel template-editor" style={{ padding: 'var(--space-5)' }}>
          {/* Header row: name / language / type */}
          <div className="template-editor-row template-editor-row-3">
            <div className="template-field">
              <label className="template-field-label" htmlFor="tpl-name">Name</label>
              <input id="tpl-name" className="input" value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Standard How-To" />
            </div>
            <div className="template-field">
              <label className="template-field-label" htmlFor="tpl-lang">Language</label>
              <input id="tpl-lang" className="input" value={draft.language} onChange={(e) => setDraft((prev) => ({ ...prev, language: e.target.value }))} placeholder="en-us" />
            </div>
            <div className="template-field">
              <label className="template-field-label" htmlFor="tpl-type">Type</label>
              <select id="tpl-type" className="input" value={draft.templateType} onChange={(e) => setDraft((prev) => ({ ...prev, templateType: e.target.value as TemplatePackType }))}>
                {TEMPLATE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          </div>

          {/* Description */}
          <div className="template-field">
            <label className="template-field-label" htmlFor="tpl-desc">Description</label>
            <input id="tpl-desc" className="input" value={draft.description} onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))} placeholder="Short summary of this template's purpose" />
          </div>

          {/* Active toggle */}
          <label className="template-active-toggle">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => setDraft((prev) => ({ ...prev, active: e.target.checked }))}
            />
            Template is active and available for article AI
          </label>

          {/* Prompt template */}
          <div className="template-field">
            <label className="template-field-label" htmlFor="tpl-prompt">Prompt template</label>
            <textarea
              id="tpl-prompt"
              className="draft-source-editor"
              style={{ minHeight: 140 }}
              value={draft.promptTemplate}
              onChange={(e) => setDraft((prev) => ({ ...prev, promptTemplate: e.target.value }))}
              placeholder="Write a task-focused help article that covers..."
            />
          </div>

          {/* Tone rules */}
          <div className="template-field">
            <label className="template-field-label" htmlFor="tpl-tone">Tone / style guidance</label>
            <textarea
              id="tpl-tone"
              className="draft-source-editor"
              style={{ minHeight: 100 }}
              value={draft.toneRules}
              onChange={(e) => setDraft((prev) => ({ ...prev, toneRules: e.target.value }))}
              placeholder="Use concise, direct instructions. Avoid jargon..."
            />
          </div>

          {/* Example content */}
          <div className="template-field">
            <label className="template-field-label" htmlFor="tpl-examples">Example content</label>
            <textarea
              id="tpl-examples"
              className="draft-source-editor"
              style={{ minHeight: 100 }}
              value={draft.examples ?? ''}
              onChange={(e) => setDraft((prev) => ({ ...prev, examples: e.target.value }))}
              placeholder="Paste or write an example article that follows this template..."
            />
          </div>

          {/* Analysis results */}
          {selected?.analysis && (
            <div className="template-analysis-card">
              <div className="template-analysis-header">
                <IconZap size={14} />
                <span className="template-analysis-title">Template Analysis</span>
                <Badge variant="primary">{selected.analysis.score}/100</Badge>
              </div>
              <div className="template-analysis-summary">{selected.analysis.summary}</div>

              <div className="template-analysis-sections">
                {selected.analysis.strengths.length > 0 && (
                  <div>
                    <div className="template-analysis-section-title">Strengths</div>
                    <ul className="template-analysis-list strengths">
                      {selected.analysis.strengths.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                )}
                {selected.analysis.gaps.length > 0 && (
                  <div>
                    <div className="template-analysis-section-title">Gaps</div>
                    <ul className="template-analysis-list gaps">
                      {selected.analysis.gaps.map((g, i) => <li key={i}>{g}</li>)}
                    </ul>
                  </div>
                )}
              </div>

              {selected.analysis.suggestions.length > 0 && (
                <div className="template-analysis-suggestions">
                  {selected.analysis.suggestions.map((suggestion) => (
                    <div key={suggestion.title} className="template-analysis-suggestion">
                      <span className={`template-analysis-suggestion-priority ${suggestion.priority}`}>
                        {suggestion.priority}
                      </span>
                      <div>
                        <strong>{suggestion.title}:</strong> {suggestion.detail}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="template-editor-actions">
            <button
              className="btn btn-primary"
              disabled={busy || !canSave}
              onClick={async () => {
                const saved = await saveMutation.mutate({
                  workspaceId: activeWorkspace.id,
                  templatePackId: selectedId ?? undefined,
                  name: draft.name,
                  language: draft.language,
                  templateType: draft.templateType,
                  promptTemplate: draft.promptTemplate,
                  toneRules: draft.toneRules,
                  description: draft.description,
                  examples: draft.examples,
                  active: draft.active,
                });
                if (saved) {
                  setSelectedId(saved.id);
                  await refresh();
                }
              }}
            >
              <IconCheckCircle size={14} />
              {isNewTemplate ? 'Create template' : 'Save changes'}
            </button>

            {selectedId && (
              <>
                <button
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={async () => {
                    const analyzed = await analyzeMutation.mutate({ workspaceId: activeWorkspace.id, templatePackId: selectedId });
                    if (analyzed) {
                      await refresh();
                    }
                  }}
                >
                  <IconZap size={14} /> Analyze quality
                </button>
                <button
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <IconTrash2 size={14} /> Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      <ConfirmationDialog
        open={showDeleteDialog}
        title="Delete Template Pack"
        message={
          <>
            <p>Are you sure you want to delete <strong>{selected?.name}</strong>?</p>
            <p>This action cannot be undone. Articles using this template will fall back to default context.</p>
          </>
        }
        confirmText="Delete Template"
        variant="danger"
        isProcessing={deleteMutation.loading}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={async () => {
          if (!selectedId) return;
          await deleteMutation.mutate({ workspaceId: activeWorkspace.id, templatePackId: selectedId });
          setShowDeleteDialog(false);
          setSelectedId(null);
          setDraft(emptyForm());
          await refresh();
        }}
      />
    </>
  );
};
