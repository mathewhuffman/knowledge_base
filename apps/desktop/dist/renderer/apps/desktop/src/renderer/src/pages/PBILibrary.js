import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppRoute, PBIValidationStatus, } from '@kb-vault/shared-types';
import { Badge } from '../components/Badge';
import { Drawer } from '../components/Drawer';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { useRegisterAiAssistantView } from '../components/assistant/AssistantContext';
import { IconArchive, IconArrowUpRight, IconSearch, IconX, } from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc } from '../hooks/useIpc';
const SEARCH_DEBOUNCE_MS = 250;
function formatDateTime(value) {
    try {
        return new Date(value).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });
    }
    catch {
        return value;
    }
}
function formatTitleCase(value) {
    if (!value) {
        return '—';
    }
    return value
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}
function formatValidationLabel(status) {
    switch (status) {
        case PBIValidationStatus.CANDIDATE:
            return 'Candidate';
        case PBIValidationStatus.IGNORED:
            return 'Ignored';
        case PBIValidationStatus.DUPLICATE:
            return 'Duplicate';
        case PBIValidationStatus.MALFORMED:
            return 'Malformed';
        default:
            return formatTitleCase(status);
    }
}
function formatScopeLabel(scopeState) {
    switch (scopeState) {
        case 'in_scope':
            return 'In Scope';
        case 'out_of_scope':
            return 'Out of Scope';
        case 'not_eligible':
            return 'Not Eligible';
        default:
            return formatTitleCase(scopeState);
    }
}
function validationBadgeVariant(status) {
    switch (status) {
        case PBIValidationStatus.CANDIDATE:
            return 'primary';
        case PBIValidationStatus.IGNORED:
            return 'warning';
        case PBIValidationStatus.DUPLICATE:
            return 'warning';
        case PBIValidationStatus.MALFORMED:
            return 'danger';
        default:
            return 'neutral';
    }
}
function scopeBadgeVariant(scopeState) {
    switch (scopeState) {
        case 'in_scope':
            return 'success';
        case 'out_of_scope':
            return 'warning';
        case 'not_eligible':
            return 'neutral';
        default:
            return 'neutral';
    }
}
function priorityBadgeVariant(priority) {
    switch (priority) {
        case 'low':
            return 'neutral';
        case 'medium':
            return 'primary';
        case 'high':
            return 'warning';
        case 'urgent':
            return 'danger';
        default:
            return 'neutral';
    }
}
function proposalStatusBadgeVariant(status) {
    switch (status) {
        case 'accepted':
            return 'success';
        case 'denied':
            return 'danger';
        case 'deferred':
            return 'warning';
        case 'applied_to_branch':
            return 'primary';
        case 'pending_review':
            return 'neutral';
        default:
            return 'neutral';
    }
}
function proposalActionBadgeVariant(action) {
    switch (action) {
        case 'create':
            return 'success';
        case 'edit':
            return 'primary';
        case 'retire':
            return 'danger';
        case 'no_impact':
            return 'neutral';
        default:
            return 'neutral';
    }
}
function detailSectionCopy(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : 'No content available.';
}
export function PBILibrary() {
    const { activeWorkspace } = useWorkspace();
    const batchListQuery = useIpc('pbiBatch.list');
    const listQuery = useIpc('pbiLibrary.list');
    const detailQuery = useIpc('pbiLibrary.get');
    const [listData, setListData] = useState(null);
    const [detailData, setDetailData] = useState(null);
    const [searchInput, setSearchInput] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [validationFilter, setValidationFilter] = useState('all');
    const [scopeFilter, setScopeFilter] = useState('all');
    const [batchFilter, setBatchFilter] = useState('');
    const [sortBy, setSortBy] = useState('importedAtUtc');
    const [sortDirection, setSortDirection] = useState('desc');
    const [selectedPbiId, setSelectedPbiId] = useState(null);
    const [focusedPbiId, setFocusedPbiId] = useState(null);
    const [sourceViewMode, setSourceViewMode] = useState('parsed');
    const rowRefs = useRef(new Map());
    const listRequestIdRef = useRef(0);
    const detailRequestIdRef = useRef(0);
    const items = listData?.items ?? [];
    const viewerItem = detailData?.item ?? items.find((item) => item.pbiId === selectedPbiId) ?? null;
    const batchOptions = batchListQuery.data?.batches ?? [];
    const assistantContext = useMemo(() => {
        if (!activeWorkspace) {
            return null;
        }
        const selectedDetail = detailData?.item.pbiId === selectedPbiId ? detailData : null;
        const selectedItem = selectedDetail?.item ?? viewerItem;
        const selectedPbiTitle = selectedItem
            ? `${selectedItem.externalId}: ${selectedItem.title}`
            : undefined;
        return {
            workspaceId: activeWorkspace.id,
            route: AppRoute.PBI_LIBRARY,
            routeLabel: 'PBI Library',
            subject: selectedItem
                ? {
                    type: 'pbi',
                    id: selectedItem.pbiId,
                    title: selectedPbiTitle
                }
                : {
                    type: 'workspace',
                    id: activeWorkspace.id,
                    title: activeWorkspace.name
                },
            workingState: {
                kind: 'none',
                payload: null
            },
            capabilities: {
                canChat: true,
                canCreateProposal: false,
                canPatchProposal: false,
                canPatchDraft: false,
                canPatchTemplate: false,
                canUseUnsavedWorkingState: false
            },
            backingData: selectedDetail
                ? {
                    activePbiId: selectedDetail.item.pbiId,
                    activeBatchId: selectedDetail.item.batchId,
                    selection: {
                        pbiId: selectedDetail.item.pbiId,
                        externalId: selectedDetail.item.externalId,
                        title: selectedDetail.item.title,
                        workItemType: selectedDetail.item.workItemType,
                        priority: selectedDetail.item.priority,
                        validationStatus: selectedDetail.item.validationStatus,
                        scopeState: selectedDetail.item.scopeState,
                        sourceRowNumber: selectedDetail.record.sourceRowNumber,
                        batchId: selectedDetail.batch.id,
                        batchName: selectedDetail.batch.name,
                        importedAtUtc: selectedDetail.batch.importedAtUtc
                    },
                    pbi: {
                        item: selectedDetail.item,
                        record: selectedDetail.record,
                        batch: selectedDetail.batch,
                        titlePath: selectedDetail.titlePath,
                        parent: selectedDetail.parent,
                        children: selectedDetail.children,
                        linkedProposals: selectedDetail.linkedProposals
                    },
                    filters: {
                        query: debouncedQuery,
                        validationFilter,
                        scopeFilter,
                        batchFilter,
                        sortBy,
                        sortDirection
                    }
                }
                : selectedItem
                    ? {
                        activePbiId: selectedItem.pbiId,
                        activeBatchId: selectedItem.batchId,
                        selection: {
                            pbiId: selectedItem.pbiId,
                            externalId: selectedItem.externalId,
                            title: selectedItem.title,
                            workItemType: selectedItem.workItemType,
                            priority: selectedItem.priority,
                            validationStatus: selectedItem.validationStatus,
                            scopeState: selectedItem.scopeState,
                            batchId: selectedItem.batchId,
                            batchName: selectedItem.batchName,
                            importedAtUtc: selectedItem.importedAtUtc,
                            proposalCount: selectedItem.proposalCount
                        },
                        filters: {
                            query: debouncedQuery,
                            validationFilter,
                            scopeFilter,
                            batchFilter,
                            sortBy,
                            sortDirection
                        }
                    }
                    : {
                        filters: {
                            query: debouncedQuery,
                            validationFilter,
                            scopeFilter,
                            batchFilter,
                            sortBy,
                            sortDirection
                        }
                    }
        };
    }, [
        activeWorkspace,
        batchFilter,
        debouncedQuery,
        detailData,
        scopeFilter,
        selectedPbiId,
        sortBy,
        sortDirection,
        validationFilter,
        viewerItem
    ]);
    useRegisterAiAssistantView({
        enabled: Boolean(assistantContext),
        context: assistantContext ?? {
            workspaceId: '',
            route: AppRoute.PBI_LIBRARY,
            routeLabel: 'PBI Library',
            subject: {
                type: 'workspace',
                id: 'workspace'
            },
            workingState: {
                kind: 'none',
                payload: null
            },
            capabilities: {
                canChat: true,
                canCreateProposal: false,
                canPatchProposal: false,
                canPatchDraft: false,
                canPatchTemplate: false,
                canUseUnsavedWorkingState: false
            },
            backingData: {}
        }
    });
    useEffect(() => {
        const handle = window.setTimeout(() => {
            setDebouncedQuery(searchInput.trim());
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            window.clearTimeout(handle);
        };
    }, [searchInput]);
    useEffect(() => {
        if (!activeWorkspace) {
            setListData(null);
            setDetailData(null);
            setSelectedPbiId(null);
            setFocusedPbiId(null);
            return;
        }
        void batchListQuery.execute({ workspaceId: activeWorkspace.id });
    }, [activeWorkspace?.id]);
    useEffect(() => {
        if (!activeWorkspace) {
            return;
        }
        const requestId = ++listRequestIdRef.current;
        const request = {
            workspaceId: activeWorkspace.id,
            query: debouncedQuery || undefined,
            validationStatuses: validationFilter === 'all' ? undefined : [validationFilter],
            scopeStates: scopeFilter === 'all' ? undefined : [scopeFilter],
            batchId: batchFilter || undefined,
            sortBy,
            sortDirection,
        };
        void listQuery.execute(request).then((data) => {
            if (requestId === listRequestIdRef.current && data) {
                setListData(data);
            }
        });
    }, [
        activeWorkspace?.id,
        batchFilter,
        debouncedQuery,
        scopeFilter,
        sortBy,
        sortDirection,
        validationFilter,
    ]);
    useEffect(() => {
        if (!selectedPbiId || !activeWorkspace) {
            detailRequestIdRef.current += 1;
            setDetailData(null);
            detailQuery.reset();
            return;
        }
        const requestId = ++detailRequestIdRef.current;
        setDetailData((current) => current?.item.pbiId === selectedPbiId ? current : null);
        void detailQuery.execute({
            workspaceId: activeWorkspace.id,
            pbiId: selectedPbiId,
        }).then((data) => {
            if (requestId === detailRequestIdRef.current && data?.item.pbiId === selectedPbiId) {
                setDetailData(data);
            }
        });
    }, [activeWorkspace?.id, selectedPbiId]);
    useEffect(() => {
        if (items.length === 0) {
            setFocusedPbiId(null);
            return;
        }
        const hasFocusedRow = focusedPbiId && items.some((item) => item.pbiId === focusedPbiId);
        if (!hasFocusedRow) {
            setFocusedPbiId(items[0].pbiId);
        }
    }, [focusedPbiId, items]);
    useEffect(() => {
        if (!selectedPbiId) {
            return;
        }
        const stillExists = items.some((item) => item.pbiId === selectedPbiId);
        if (!stillExists) {
            setSelectedPbiId(null);
            setDetailData(null);
        }
    }, [items, selectedPbiId]);
    useEffect(() => {
        if (!selectedPbiId) {
            return;
        }
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setSelectedPbiId(null);
                setDetailData(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [selectedPbiId]);
    useEffect(() => {
        setSourceViewMode('parsed');
    }, [selectedPbiId]);
    function handleSort(nextSortBy) {
        if (sortBy === nextSortBy) {
            setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
            return;
        }
        setSortBy(nextSortBy);
        setSortDirection(nextSortBy === 'importedAtUtc' ? 'desc' : 'asc');
    }
    function focusRowAt(index) {
        const nextItem = items[index];
        if (!nextItem) {
            return;
        }
        setFocusedPbiId(nextItem.pbiId);
        rowRefs.current.get(nextItem.pbiId)?.focus();
    }
    function openViewer(pbiId) {
        setSelectedPbiId(pbiId);
    }
    function closeViewer() {
        setSelectedPbiId(null);
        setDetailData(null);
    }
    function handleRowKeyDown(event, index, pbiId) {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusRowAt(Math.min(index + 1, items.length - 1));
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusRowAt(Math.max(index - 1, 0));
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            openViewer(pbiId);
        }
    }
    function setRowRef(pbiId, node) {
        if (node) {
            rowRefs.current.set(pbiId, node);
            return;
        }
        rowRefs.current.delete(pbiId);
    }
    function openProposalReview(proposalId) {
        void window.kbv.invoke('app.navigation.dispatch', {
            action: {
                type: 'open_proposal_review',
                proposalId,
            },
        });
    }
    function renderSortButton(label, field) {
        const active = sortBy === field;
        const indicator = !active ? '' : sortDirection === 'asc' ? '↑' : '↓';
        return (_jsxs("button", { type: "button", className: `pbi-library-sort-btn${active ? ' is-active' : ''}`, onClick: () => handleSort(field), children: [_jsx("span", { children: label }), _jsx("span", { className: "pbi-library-sort-indicator", "aria-hidden": "true", children: indicator })] }));
    }
    if (!activeWorkspace) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "PBI Library", subtitle: "No workspace selected" }), _jsx("div", { className: "route-content", children: _jsx(EmptyState, { icon: _jsx(IconArchive, { size: 48 }), title: "No workspace open", description: "Open or create a workspace to search and inspect imported PBIs." }) })] }));
    }
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "PBI Library", subtitle: "Search and inspect uploaded PBIs across this workspace." }), _jsx("div", { className: "route-content pbi-library-page", children: listQuery.loading && !listData ? (_jsx(LoadingState, { message: "Loading PBI library..." })) : listQuery.error && !listData ? (_jsx(ErrorState, { title: "Failed to load PBI library", description: listQuery.error, action: (_jsx("button", { type: "button", className: "btn btn-primary", onClick: () => {
                            const requestId = ++listRequestIdRef.current;
                            void listQuery.execute({
                                workspaceId: activeWorkspace.id,
                                query: debouncedQuery || undefined,
                                validationStatuses: validationFilter === 'all' ? undefined : [validationFilter],
                                scopeStates: scopeFilter === 'all' ? undefined : [scopeFilter],
                                batchId: batchFilter || undefined,
                                sortBy,
                                sortDirection,
                            }).then((data) => {
                                if (requestId === listRequestIdRef.current && data) {
                                    setListData(data);
                                }
                            });
                        }, children: "Retry" })) })) : items.length === 0 ? (_jsxs("div", { className: "pbi-library-surface", children: [_jsxs("div", { className: "pbi-library-toolbar", children: [_jsxs("label", { className: "pbi-library-search", children: [_jsx(IconSearch, { size: 16, className: "pbi-library-search-icon" }), _jsx("input", { className: "input", type: "search", value: searchInput, onChange: (event) => setSearchInput(event.target.value), placeholder: "Search by ID, title, description, batch, or source file" })] }), _jsxs("select", { className: "select", value: validationFilter, onChange: (event) => setValidationFilter(event.target.value), children: [_jsx("option", { value: "all", children: "All validation" }), _jsx("option", { value: PBIValidationStatus.CANDIDATE, children: "Candidate" }), _jsx("option", { value: PBIValidationStatus.IGNORED, children: "Ignored" }), _jsx("option", { value: PBIValidationStatus.DUPLICATE, children: "Duplicate" }), _jsx("option", { value: PBIValidationStatus.MALFORMED, children: "Malformed" })] }), _jsxs("select", { className: "select", value: scopeFilter, onChange: (event) => setScopeFilter(event.target.value), children: [_jsx("option", { value: "all", children: "All scope" }), _jsx("option", { value: "in_scope", children: "In Scope" }), _jsx("option", { value: "out_of_scope", children: "Out of Scope" }), _jsx("option", { value: "not_eligible", children: "Not Eligible" })] }), _jsxs("select", { className: "select", value: batchFilter, onChange: (event) => setBatchFilter(event.target.value), children: [_jsx("option", { value: "", children: "All batches" }), batchOptions.map((batch) => (_jsx("option", { value: batch.id, children: batch.name }, batch.id)))] })] }), _jsx("div", { className: "card", children: _jsx(EmptyState, { icon: _jsx(IconArchive, { size: 48 }), title: "No PBIs match the current filters", description: "Try a different search, adjust the scope filters, or import a new PBI batch." }) })] })) : (_jsxs("div", { className: "pbi-library-surface", children: [_jsxs("div", { className: "pbi-library-toolbar", children: [_jsxs("label", { className: "pbi-library-search", children: [_jsx(IconSearch, { size: 16, className: "pbi-library-search-icon" }), _jsx("input", { className: "input", type: "search", value: searchInput, onChange: (event) => setSearchInput(event.target.value), placeholder: "Search by ID, title, description, batch, or source file" })] }), _jsxs("select", { className: "select", value: validationFilter, onChange: (event) => setValidationFilter(event.target.value), children: [_jsx("option", { value: "all", children: "All validation" }), _jsx("option", { value: PBIValidationStatus.CANDIDATE, children: "Candidate" }), _jsx("option", { value: PBIValidationStatus.IGNORED, children: "Ignored" }), _jsx("option", { value: PBIValidationStatus.DUPLICATE, children: "Duplicate" }), _jsx("option", { value: PBIValidationStatus.MALFORMED, children: "Malformed" })] }), _jsxs("select", { className: "select", value: scopeFilter, onChange: (event) => setScopeFilter(event.target.value), children: [_jsx("option", { value: "all", children: "All scope" }), _jsx("option", { value: "in_scope", children: "In Scope" }), _jsx("option", { value: "out_of_scope", children: "Out of Scope" }), _jsx("option", { value: "not_eligible", children: "Not Eligible" })] }), _jsxs("select", { className: "select", value: batchFilter, onChange: (event) => setBatchFilter(event.target.value), children: [_jsx("option", { value: "", children: "All batches" }), batchOptions.map((batch) => (_jsx("option", { value: batch.id, children: batch.name }, batch.id)))] })] }), _jsxs("div", { className: "card", children: [_jsxs("div", { className: "pbi-library-table-header", children: [_jsxs("span", { children: [items.length, " PBIs"] }), listQuery.loading ? _jsx("span", { children: "Refreshing\u2026" }) : null] }), _jsx("div", { className: "table-wrapper", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: renderSortButton('External ID', 'externalId') }), _jsx("th", { children: renderSortButton('Title', 'title') }), _jsx("th", { children: renderSortButton('Work Item Type', 'workItemType') }), _jsx("th", { children: renderSortButton('Priority', 'priority') }), _jsx("th", { children: renderSortButton('Validation', 'validationStatus') }), _jsx("th", { children: renderSortButton('Scope', 'scopeState') }), _jsx("th", { children: renderSortButton('Batch', 'batchName') }), _jsx("th", { children: renderSortButton('Imported', 'importedAtUtc') }), _jsx("th", { children: renderSortButton('Linked Proposals', 'proposalCount') })] }) }), _jsx("tbody", { children: items.map((item, index) => (_jsxs("tr", { ref: (node) => setRowRef(item.pbiId, node), className: `pbi-library-row${selectedPbiId === item.pbiId ? ' is-selected' : ''}`, tabIndex: focusedPbiId === item.pbiId ? 0 : -1, "aria-selected": selectedPbiId === item.pbiId, onClick: () => openViewer(item.pbiId), onFocus: () => setFocusedPbiId(item.pbiId), onKeyDown: (event) => handleRowKeyDown(event, index, item.pbiId), children: [_jsx("td", { children: _jsx("code", { className: "pbi-library-code", children: item.externalId }) }), _jsx("td", { children: _jsx("div", { className: "pbi-library-title-cell", children: item.title }) }), _jsx("td", { children: item.workItemType || '—' }), _jsx("td", { children: item.priority ? (_jsx(Badge, { variant: priorityBadgeVariant(item.priority), children: formatTitleCase(item.priority) })) : '—' }), _jsx("td", { children: _jsx(Badge, { variant: validationBadgeVariant(item.validationStatus), children: formatValidationLabel(item.validationStatus) }) }), _jsx("td", { children: _jsx(Badge, { variant: scopeBadgeVariant(item.scopeState), children: formatScopeLabel(item.scopeState) }) }), _jsx("td", { children: _jsxs("div", { className: "pbi-library-batch-cell", children: [_jsx("span", { children: item.batchName }), _jsx("span", { children: item.sourceFileName })] }) }), _jsx("td", { children: formatDateTime(item.importedAtUtc) }), _jsx("td", { children: item.proposalCount })] }, item.pbiId))) })] }) })] })] })) }), _jsx(Drawer, { open: Boolean(selectedPbiId), onClose: closeViewer, title: viewerItem?.title ?? 'PBI Viewer', variant: "fullscreen", customHeader: (_jsx("div", { className: "article-detail-toolbar pbi-library-viewer-toolbar", children: _jsxs("div", { className: "article-detail-toolbar-top", children: [_jsxs("div", { className: "pbi-library-viewer-heading", children: [_jsx("div", { className: "pbi-library-viewer-id", children: viewerItem?.externalId ?? 'Loading PBI...' }), _jsxs("div", { className: "article-detail-title-group", children: [_jsx("div", { className: "article-detail-title", children: viewerItem?.title ?? 'Loading PBI...' }), _jsx("div", { className: "article-detail-badges", children: viewerItem ? (_jsxs(_Fragment, { children: [_jsx(Badge, { variant: validationBadgeVariant(viewerItem.validationStatus), children: formatValidationLabel(viewerItem.validationStatus) }), _jsx(Badge, { variant: scopeBadgeVariant(viewerItem.scopeState), children: formatScopeLabel(viewerItem.scopeState) })] })) : null })] })] }), _jsx("button", { type: "button", className: "btn btn-ghost btn-icon", onClick: closeViewer, "aria-label": "Close PBI viewer", children: _jsx(IconX, { size: 16 }) })] }) })), children: detailQuery.loading && !detailData ? (_jsx(LoadingState, { message: "Loading PBI details..." })) : detailQuery.error && !detailData ? (_jsx("div", { className: "pbi-library-viewer-body", children: _jsx(ErrorState, { title: "Failed to load PBI details", description: detailQuery.error, action: (_jsx("button", { type: "button", className: "btn btn-primary", onClick: () => {
                                if (!activeWorkspace || !selectedPbiId) {
                                    return;
                                }
                                const requestId = ++detailRequestIdRef.current;
                                void detailQuery.execute({
                                    workspaceId: activeWorkspace.id,
                                    pbiId: selectedPbiId,
                                }).then((data) => {
                                    if (requestId === detailRequestIdRef.current && data?.item.pbiId === selectedPbiId) {
                                        setDetailData(data);
                                    }
                                });
                            }, children: "Retry" })) }) })) : detailData ? (_jsxs("div", { className: "pbi-library-viewer-body", children: [_jsxs("section", { className: "pbi-library-viewer-section", children: [_jsx("div", { className: "pbi-library-viewer-section-title", children: "Overview" }), _jsxs("div", { className: "pbi-library-meta-grid", children: [_jsxs("div", { className: "pbi-library-meta-item", children: [_jsx("span", { className: "pbi-library-meta-label", children: "Title hierarchy" }), _jsx("span", { className: "pbi-library-meta-value", children: detailData.titlePath.length > 0 ? detailData.titlePath.join(' / ') : detailData.record.title })] }), _jsxs("div", { className: "pbi-library-meta-item", children: [_jsx("span", { className: "pbi-library-meta-label", children: "Work item type" }), _jsx("span", { className: "pbi-library-meta-value", children: detailData.record.workItemType || '—' })] }), _jsxs("div", { className: "pbi-library-meta-item", children: [_jsx("span", { className: "pbi-library-meta-label", children: "Priority" }), _jsx("span", { className: "pbi-library-meta-value", children: detailData.record.priority ? formatTitleCase(detailData.record.priority) : '—' })] }), _jsxs("div", { className: "pbi-library-meta-item", children: [_jsx("span", { className: "pbi-library-meta-label", children: "Source row number" }), _jsx("span", { className: "pbi-library-meta-value", children: detailData.record.sourceRowNumber })] }), _jsxs("div", { className: "pbi-library-meta-item", children: [_jsx("span", { className: "pbi-library-meta-label", children: "Batch" }), _jsx("span", { className: "pbi-library-meta-value", children: detailData.batch.name })] }), _jsxs("div", { className: "pbi-library-meta-item", children: [_jsx("span", { className: "pbi-library-meta-label", children: "Import date" }), _jsx("span", { className: "pbi-library-meta-value", children: formatDateTime(detailData.batch.importedAtUtc) })] })] })] }), _jsxs("section", { className: "pbi-library-viewer-section", children: [_jsx("div", { className: "pbi-library-viewer-section-title", children: "Metadata" }), _jsxs("div", { className: "pbi-library-meta-grid", children: [_jsxs("div", { className: "pbi-library-meta-item", children: [_jsx("span", { className: "pbi-library-meta-label", children: "Validation status" }), _jsx("span", { className: "pbi-library-meta-value", children: formatValidationLabel(detailData.item.validationStatus) })] }), _jsxs("div", { className: "pbi-library-meta-item", children: [_jsx("span", { className: "pbi-library-meta-label", children: "Validation reason" }), _jsx("span", { className: "pbi-library-meta-value", children: detailData.record.validationReason || '—' })] }), _jsxs("div", { className: "pbi-library-meta-item", children: [_jsx("span", { className: "pbi-library-meta-label", children: "Scope state" }), _jsx("span", { className: "pbi-library-meta-value", children: formatScopeLabel(detailData.item.scopeState) })] }), _jsxs("div", { className: "pbi-library-meta-item", children: [_jsx("span", { className: "pbi-library-meta-label", children: "Parent external ID" }), _jsx("span", { className: "pbi-library-meta-value", children: detailData.record.parentExternalId || '—' })] }), _jsxs("div", { className: "pbi-library-meta-item pbi-library-meta-item--wide", children: [_jsx("span", { className: "pbi-library-meta-label", children: "Parent linked row" }), _jsx("span", { className: "pbi-library-meta-value", children: detailData.parent ? `${detailData.parent.externalId} — ${detailData.parent.title}` : '—' })] }), _jsxs("div", { className: "pbi-library-meta-item pbi-library-meta-item--wide", children: [_jsx("span", { className: "pbi-library-meta-label", children: "Child rows" }), detailData.children.length > 0 ? (_jsx("div", { className: "pbi-library-summary-list", children: detailData.children.map((child) => (_jsxs("div", { className: "pbi-library-summary-row", children: [_jsx("code", { className: "pbi-library-code", children: child.externalId }), _jsx("span", { children: child.title })] }, child.pbiId))) })) : (_jsx("span", { className: "pbi-library-meta-value", children: "No child rows." }))] })] })] }), _jsxs("section", { className: "pbi-library-viewer-section", children: [_jsx("div", { className: "pbi-library-viewer-section-title", children: "Description" }), _jsx("div", { className: "pbi-library-copy-block", children: detailSectionCopy(detailData.record.descriptionText) })] }), _jsxs("section", { className: "pbi-library-viewer-section", children: [_jsx("div", { className: "pbi-library-viewer-section-title", children: "Acceptance Criteria" }), _jsx("div", { className: "pbi-library-copy-block", children: detailSectionCopy(detailData.record.acceptanceCriteriaText) })] }), _jsxs("section", { className: "pbi-library-viewer-section", children: [_jsxs("div", { className: "pbi-library-viewer-section-header", children: [_jsx("div", { className: "pbi-library-viewer-section-title", children: "Source" }), _jsxs("div", { className: "pbi-library-toggle", children: [_jsx("button", { type: "button", className: `pbi-library-toggle-btn${sourceViewMode === 'parsed' ? ' is-active' : ''}`, onClick: () => setSourceViewMode('parsed'), children: "Parsed" }), _jsx("button", { type: "button", className: `pbi-library-toggle-btn${sourceViewMode === 'raw' ? ' is-active' : ''}`, onClick: () => setSourceViewMode('raw'), children: "Raw" })] })] }), _jsxs("div", { className: "pbi-library-source-grid", children: [_jsxs("div", { className: "pbi-library-source-block", children: [_jsx("div", { className: "pbi-library-source-title", children: "Description" }), sourceViewMode === 'raw' ? (_jsx("pre", { className: "pbi-library-pre", children: detailSectionCopy(detailData.record.rawDescription) })) : (_jsx("pre", { className: "pbi-library-pre", children: detailSectionCopy(detailData.record.descriptionText) }))] }), _jsxs("div", { className: "pbi-library-source-block", children: [_jsx("div", { className: "pbi-library-source-title", children: "Acceptance Criteria" }), sourceViewMode === 'raw' ? (_jsx("pre", { className: "pbi-library-pre", children: detailSectionCopy(detailData.record.rawAcceptanceCriteria) })) : (_jsx("pre", { className: "pbi-library-pre", children: detailSectionCopy(detailData.record.acceptanceCriteriaText) }))] })] })] }), _jsxs("section", { className: "pbi-library-viewer-section", children: [_jsx("div", { className: "pbi-library-viewer-section-title", children: "Linked Proposals" }), detailData.linkedProposals.length > 0 ? (_jsx("div", { className: "pbi-library-linked-list", children: detailData.linkedProposals.map((proposal) => (_jsxs("div", { className: "pbi-library-linked-row", children: [_jsxs("div", { className: "pbi-library-linked-row-main", children: [_jsx("code", { className: "pbi-library-code", children: proposal.proposalId }), _jsx(Badge, { variant: proposalActionBadgeVariant(proposal.action), children: formatTitleCase(proposal.action) }), _jsx(Badge, { variant: proposalStatusBadgeVariant(proposal.reviewStatus), children: formatTitleCase(proposal.reviewStatus) })] }), _jsx("div", { className: "pbi-library-linked-row-meta", children: formatDateTime(proposal.generatedAtUtc) }), _jsxs("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: () => openProposalReview(proposal.proposalId), children: [_jsx(IconArrowUpRight, { size: 14 }), "Open in Proposal Review"] })] }, proposal.proposalId))) })) : (_jsx("div", { className: "pbi-library-copy-block", children: "No linked proposals." }))] })] })) : (_jsx("div", { className: "pbi-library-viewer-body", children: _jsx(LoadingState, { message: "Preparing viewer..." }) })) })] }));
}
