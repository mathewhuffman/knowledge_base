import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { AppRoute, TemplatePackType, buildAppWorkingStateVersionToken } from '@kb-vault/shared-types';
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
import { usePersistedResize } from '../hooks/usePersistedResize';
const NEW_TEMPLATE_ID = 'new-template-draft';
const TEMPLATE_TYPE_OPTIONS = [
    { value: TemplatePackType.STANDARD_HOW_TO, label: 'Standard How-To' },
    { value: TemplatePackType.FAQ, label: 'FAQ' },
    { value: TemplatePackType.TROUBLESHOOTING, label: 'Troubleshooting' },
    { value: TemplatePackType.POLICY_NOTICE, label: 'Policy / Notice' },
    { value: TemplatePackType.FEATURE_OVERVIEW, label: 'Feature Overview' },
];
function templateTypeLabel(type) {
    return TEMPLATE_TYPE_OPTIONS.find(o => o.value === type)?.label ?? type.replace(/_/g, ' ');
}
function emptyForm() {
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
    const listQuery = useIpc('template.pack.list');
    const saveMutation = useIpcMutation('template.pack.save');
    const deleteMutation = useIpcMutation('template.pack.delete');
    const analyzeMutation = useIpcMutation('template.pack.analyze');
    const [selectedId, setSelectedId] = useState(null);
    const [isCreatingNew, setIsCreatingNew] = useState(false);
    const [draft, setDraft] = useState(emptyForm());
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const prompt = usePersistedResize('tpl-prompt', 140);
    const tone = usePersistedResize('tpl-tone', 100);
    const examples = usePersistedResize('tpl-examples', 100);
    useEffect(() => {
        if (!activeWorkspace)
            return;
        setIsCreatingNew(false);
        setSelectedId(null);
        setDraft(emptyForm());
        void listQuery.execute({ workspaceId: activeWorkspace.id, includeInactive: true });
    }, [activeWorkspace]);
    const templates = listQuery.data?.templates ?? [];
    const visibleTemplates = useMemo(() => {
        if (!activeWorkspace || !isCreatingNew)
            return templates;
        return [
            {
                id: NEW_TEMPLATE_ID,
                workspaceId: activeWorkspace.id,
                name: draft.name || 'Untitled template',
                language: draft.language,
                promptTemplate: draft.promptTemplate,
                toneRules: draft.toneRules,
                examples: draft.examples,
                active: draft.active,
                updatedAtUtc: '',
                templateType: draft.templateType,
                description: draft.description || 'No description yet.',
                analysisSummary: draft.analysisSummary,
                analysis: draft.analysis,
            },
            ...templates,
        ];
    }, [activeWorkspace, draft, isCreatingNew, templates]);
    useEffect(() => {
        const firstId = templates[0]?.id;
        if (isCreatingNew) {
            return;
        }
        if (selectedId && templates.some((template) => template.id === selectedId)) {
            return;
        }
        if (firstId) {
            setSelectedId(firstId);
        }
    }, [isCreatingNew, selectedId, templates]);
    const selected = useMemo(() => templates.find((template) => template.id === selectedId) ?? null, [templates, selectedId]);
    useEffect(() => {
        if (isCreatingNew) {
            setDraft(emptyForm());
        }
        else if (selected) {
            setDraft({
                ...selected,
                description: selected.description ?? '',
                examples: selected.examples ?? '',
            });
        }
        else if (!selectedId) {
            setDraft(emptyForm());
        }
    }, [isCreatingNew, selected, selectedId]);
    const templateVersionToken = useMemo(() => buildAppWorkingStateVersionToken({
        route: AppRoute.TEMPLATES_AND_PROMPTS,
        entityType: 'template_pack',
        entityId: selectedId ?? 'new-template',
        currentValues: draft
    }), [draft, selectedId]);
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
        applyUiActions: (actions) => {
            actions.forEach((action) => {
                if (action.type === 'replace_template_form') {
                    setDraft((prev) => ({
                        ...prev,
                        ...action.payload,
                        templateType: action.payload.templateType ?? prev.templateType
                    }));
                }
            });
        },
        applyWorkingStatePatch: (patch) => {
            setDraft((prev) => ({
                ...prev,
                ...patch,
                templateType: patch.templateType ?? prev.templateType
            }));
        }
    });
    const refresh = async () => {
        if (!activeWorkspace)
            return;
        await listQuery.execute({ workspaceId: activeWorkspace.id, includeInactive: true });
    };
    if (!activeWorkspace) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Templates & Prompts", subtitle: "Open a workspace to manage article templates." }), _jsx("div", { className: "route-content", children: _jsx(EmptyState, { icon: _jsx(IconLayout, { size: 40 }), title: "No workspace selected", description: "Choose a workspace to edit local template packs." }) })] }));
    }
    const busy = saveMutation.loading || deleteMutation.loading || analyzeMutation.loading;
    const isNewTemplate = isCreatingNew;
    const canSave = draft.name.trim() && draft.promptTemplate.trim() && draft.toneRules.trim();
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Templates & Prompts", subtitle: "Edit local template packs and prompt guidance for article AI", actions: (_jsxs("button", { className: "btn btn-primary", onClick: () => {
                        setIsCreatingNew(true);
                        setSelectedId(null);
                        setDraft(emptyForm());
                    }, children: [_jsx(IconPlus, { size: 14 }), "New Template"] })) }), _jsxs("div", { className: "route-content", style: { display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: 'var(--space-5)', alignItems: 'start' }, children: [_jsx("div", { className: "panel template-list-panel", style: { padding: 'var(--space-3)' }, children: listQuery.loading && !listQuery.data ? (_jsx(LoadingState, { message: "Loading template packs..." })) : listQuery.error && !listQuery.data ? (_jsx(ErrorState, { title: "Unable to load templates", description: listQuery.error })) : visibleTemplates.length === 0 ? (_jsx(EmptyState, { icon: _jsx(IconLayout, { size: 32 }), title: "No templates yet", description: "Create your first local template pack." })) : (visibleTemplates.map((template) => (_jsxs("button", { type: "button", className: `template-card${(template.id === selectedId || (isCreatingNew && template.id === NEW_TEMPLATE_ID)) ? ' selected' : ''}`, onClick: () => {
                                if (template.id === NEW_TEMPLATE_ID) {
                                    setIsCreatingNew(true);
                                    setSelectedId(null);
                                    return;
                                }
                                setIsCreatingNew(false);
                                setSelectedId(template.id);
                            }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-2)' }, children: [_jsx("span", { className: "template-card-title", children: template.name }), _jsx(Badge, { variant: template.active ? 'success' : 'neutral', children: template.active ? 'active' : 'inactive' })] }), _jsx("div", { className: "template-card-desc", children: template.description || 'No description yet.' }), _jsxs("div", { className: "template-card-tags", children: [_jsx(Badge, { variant: "neutral", children: template.language }), _jsx(Badge, { variant: "primary", children: templateTypeLabel(template.templateType) })] }), template.analysisSummary && (_jsx("div", { className: "template-card-analysis", children: template.analysisSummary }))] }, template.id)))) }), _jsxs("div", { className: "panel template-editor", style: { padding: 'var(--space-5)' }, children: [_jsxs("div", { className: "template-editor-row template-editor-row-3", children: [_jsxs("div", { className: "template-field", children: [_jsx("label", { className: "template-field-label", htmlFor: "tpl-name", children: "Name" }), _jsx("input", { id: "tpl-name", className: "input", value: draft.name, onChange: (e) => setDraft((prev) => ({ ...prev, name: e.target.value })), placeholder: "e.g. Standard How-To" })] }), _jsxs("div", { className: "template-field", children: [_jsx("label", { className: "template-field-label", htmlFor: "tpl-lang", children: "Language" }), _jsx("input", { id: "tpl-lang", className: "input", value: draft.language, onChange: (e) => setDraft((prev) => ({ ...prev, language: e.target.value })), placeholder: "en-us" })] }), _jsxs("div", { className: "template-field", children: [_jsx("label", { className: "template-field-label", htmlFor: "tpl-type", children: "Type" }), _jsx("select", { id: "tpl-type", className: "input", value: draft.templateType, onChange: (e) => setDraft((prev) => ({ ...prev, templateType: e.target.value })), children: TEMPLATE_TYPE_OPTIONS.map((option) => _jsx("option", { value: option.value, children: option.label }, option.value)) })] })] }), _jsxs("div", { className: "template-field", children: [_jsx("label", { className: "template-field-label", htmlFor: "tpl-desc", children: "Description" }), _jsx("input", { id: "tpl-desc", className: "input", value: draft.description, onChange: (e) => setDraft((prev) => ({ ...prev, description: e.target.value })), placeholder: "Short summary of this template's purpose" })] }), _jsxs("label", { className: "template-active-toggle", children: [_jsx("input", { type: "checkbox", checked: draft.active, onChange: (e) => setDraft((prev) => ({ ...prev, active: e.target.checked })) }), "Template is active and available for article AI"] }), _jsxs("div", { className: "template-field", children: [_jsx("label", { className: "template-field-label", htmlFor: "tpl-prompt", children: "Prompt template" }), _jsxs("div", { className: "resizable-textarea-wrapper", children: [_jsx("textarea", { id: "tpl-prompt", ref: prompt.textareaRef, className: "draft-source-editor template-resizable-textarea", value: draft.promptTemplate, onChange: (e) => setDraft((prev) => ({ ...prev, promptTemplate: e.target.value })), placeholder: "Write a task-focused help article that covers..." }), _jsx("div", { className: "resize-handle", ...prompt.handleProps })] })] }), _jsxs("div", { className: "template-field", children: [_jsx("label", { className: "template-field-label", htmlFor: "tpl-tone", children: "Tone / style guidance" }), _jsxs("div", { className: "resizable-textarea-wrapper", children: [_jsx("textarea", { id: "tpl-tone", ref: tone.textareaRef, className: "draft-source-editor template-resizable-textarea", value: draft.toneRules, onChange: (e) => setDraft((prev) => ({ ...prev, toneRules: e.target.value })), placeholder: "Use concise, direct instructions. Avoid jargon..." }), _jsx("div", { className: "resize-handle", ...tone.handleProps })] })] }), _jsxs("div", { className: "template-field", children: [_jsx("label", { className: "template-field-label", htmlFor: "tpl-examples", children: "Example content" }), _jsxs("div", { className: "resizable-textarea-wrapper", children: [_jsx("textarea", { id: "tpl-examples", ref: examples.textareaRef, className: "draft-source-editor template-resizable-textarea", value: draft.examples ?? '', onChange: (e) => setDraft((prev) => ({ ...prev, examples: e.target.value })), placeholder: "Paste or write an example article that follows this template..." }), _jsx("div", { className: "resize-handle", ...examples.handleProps })] })] }), selected?.analysis && (_jsxs("div", { className: "template-analysis-card", children: [_jsxs("div", { className: "template-analysis-header", children: [_jsx(IconZap, { size: 14 }), _jsx("span", { className: "template-analysis-title", children: "Template Analysis" }), _jsxs(Badge, { variant: "primary", children: [selected.analysis.score, "/100"] })] }), _jsx("div", { className: "template-analysis-summary", children: selected.analysis.summary }), _jsxs("div", { className: "template-analysis-sections", children: [selected.analysis.strengths.length > 0 && (_jsxs("div", { children: [_jsx("div", { className: "template-analysis-section-title", children: "Strengths" }), _jsx("ul", { className: "template-analysis-list strengths", children: selected.analysis.strengths.map((s, i) => _jsx("li", { children: s }, i)) })] })), selected.analysis.gaps.length > 0 && (_jsxs("div", { children: [_jsx("div", { className: "template-analysis-section-title", children: "Gaps" }), _jsx("ul", { className: "template-analysis-list gaps", children: selected.analysis.gaps.map((g, i) => _jsx("li", { children: g }, i)) })] }))] }), selected.analysis.suggestions.length > 0 && (_jsx("div", { className: "template-analysis-suggestions", children: selected.analysis.suggestions.map((suggestion) => (_jsxs("div", { className: "template-analysis-suggestion", children: [_jsx("span", { className: `template-analysis-suggestion-priority ${suggestion.priority}`, children: suggestion.priority }), _jsxs("div", { children: [_jsxs("strong", { children: [suggestion.title, ":"] }), " ", suggestion.detail] })] }, suggestion.title))) }))] })), _jsxs("div", { className: "template-editor-actions", children: [_jsxs("button", { className: "btn btn-primary", disabled: busy || !canSave, onClick: async () => {
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
                                                setIsCreatingNew(false);
                                                setSelectedId(saved.id);
                                                await refresh();
                                            }
                                        }, children: [_jsx(IconCheckCircle, { size: 14 }), isNewTemplate ? 'Create template' : 'Save changes'] }), selectedId && (_jsxs(_Fragment, { children: [_jsxs("button", { className: "btn btn-secondary", disabled: busy, onClick: async () => {
                                                    const analyzed = await analyzeMutation.mutate({ workspaceId: activeWorkspace.id, templatePackId: selectedId });
                                                    if (analyzed) {
                                                        await refresh();
                                                    }
                                                }, children: [_jsx(IconZap, { size: 14 }), " Analyze quality"] }), _jsxs("button", { className: "btn btn-danger", disabled: busy, onClick: () => setShowDeleteDialog(true), children: [_jsx(IconTrash2, { size: 14 }), " Delete"] })] }))] })] })] }), _jsx(ConfirmationDialog, { open: showDeleteDialog, title: "Delete Template Pack", message: _jsxs(_Fragment, { children: [_jsxs("p", { children: ["Are you sure you want to delete ", _jsx("strong", { children: selected?.name }), "?"] }), _jsx("p", { children: "This action cannot be undone. Articles using this template will fall back to default context." })] }), confirmText: "Delete Template", variant: "danger", isProcessing: deleteMutation.loading, onClose: () => setShowDeleteDialog(false), onConfirm: async () => {
                    if (!selectedId)
                        return;
                    await deleteMutation.mutate({ workspaceId: activeWorkspace.id, templatePackId: selectedId });
                    setShowDeleteDialog(false);
                    setIsCreatingNew(false);
                    setSelectedId(null);
                    setDraft(emptyForm());
                    await refresh();
                } })] }));
};
