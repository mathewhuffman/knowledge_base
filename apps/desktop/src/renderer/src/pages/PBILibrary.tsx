import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  AppRoute,
  type PBIBatchRecord,
  PBIValidationStatus,
  type PBILibraryDetailResponse,
  type PBILibraryListResponse,
  type PBILibraryScopeState,
  type PBILibrarySortField,
} from '@kb-vault/shared-types';
import { Badge } from '../components/Badge';
import { Drawer } from '../components/Drawer';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { useRegisterAiAssistantView } from '../components/assistant/AssistantContext';
import {
  IconArchive,
  IconArrowUpRight,
  IconSearch,
  IconX,
} from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc } from '../hooks/useIpc';

const SEARCH_DEBOUNCE_MS = 250;

type ValidationFilterValue = 'all' | PBIValidationStatus;
type ScopeFilterValue = 'all' | PBILibraryScopeState;
type SortDirection = 'asc' | 'desc';

function formatDateTime(value: string): string {
  try {
    return new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function formatTitleCase(value?: string): string {
  if (!value) {
    return '—';
  }

  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatValidationLabel(status: PBIValidationStatus): string {
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

function formatScopeLabel(scopeState: PBILibraryScopeState): string {
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

function validationBadgeVariant(status: PBIValidationStatus): 'neutral' | 'primary' | 'success' | 'warning' | 'danger' {
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

function scopeBadgeVariant(scopeState: PBILibraryScopeState): 'neutral' | 'primary' | 'success' | 'warning' | 'danger' {
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

function priorityBadgeVariant(priority?: string): 'neutral' | 'primary' | 'success' | 'warning' | 'danger' {
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

function proposalStatusBadgeVariant(status?: string): 'neutral' | 'primary' | 'success' | 'warning' | 'danger' {
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

function proposalActionBadgeVariant(action?: string): 'neutral' | 'primary' | 'success' | 'warning' | 'danger' {
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

function detailSectionCopy(value?: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : 'No content available.';
}

export function PBILibrary() {
  const { activeWorkspace } = useWorkspace();
  const batchListQuery = useIpc<{ workspaceId: string; batches: PBIBatchRecord[] }>('pbiBatch.list');
  const listQuery = useIpc<PBILibraryListResponse>('pbiLibrary.list');
  const detailQuery = useIpc<PBILibraryDetailResponse>('pbiLibrary.get');

  const [listData, setListData] = useState<PBILibraryListResponse | null>(null);
  const [detailData, setDetailData] = useState<PBILibraryDetailResponse | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [validationFilter, setValidationFilter] = useState<ValidationFilterValue>('all');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilterValue>('all');
  const [batchFilter, setBatchFilter] = useState('');
  const [sortBy, setSortBy] = useState<PBILibrarySortField>('importedAtUtc');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedPbiId, setSelectedPbiId] = useState<string | null>(null);
  const [focusedPbiId, setFocusedPbiId] = useState<string | null>(null);
  const [sourceViewMode, setSourceViewMode] = useState<'parsed' | 'raw'>('parsed');

  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
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
            type: 'pbi' as const,
            id: selectedItem.pbiId,
            title: selectedPbiTitle
          }
        : {
            type: 'workspace' as const,
            id: activeWorkspace.id,
            title: activeWorkspace.name
          },
      workingState: {
        kind: 'none' as const,
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

    const handleKeyDown = (event: KeyboardEvent) => {
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

  function handleSort(nextSortBy: PBILibrarySortField) {
    if (sortBy === nextSortBy) {
      setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
      return;
    }

    setSortBy(nextSortBy);
    setSortDirection(nextSortBy === 'importedAtUtc' ? 'desc' : 'asc');
  }

  function focusRowAt(index: number) {
    const nextItem = items[index];
    if (!nextItem) {
      return;
    }

    setFocusedPbiId(nextItem.pbiId);
    rowRefs.current.get(nextItem.pbiId)?.focus();
  }

  function openViewer(pbiId: string) {
    setSelectedPbiId(pbiId);
  }

  function closeViewer() {
    setSelectedPbiId(null);
    setDetailData(null);
  }

  function handleRowKeyDown(event: ReactKeyboardEvent<HTMLTableRowElement>, index: number, pbiId: string) {
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

  function setRowRef(pbiId: string, node: HTMLTableRowElement | null) {
    if (node) {
      rowRefs.current.set(pbiId, node);
      return;
    }

    rowRefs.current.delete(pbiId);
  }

  function openProposalReview(proposalId: string) {
    void window.kbv.invoke('app.navigation.dispatch', {
      action: {
        type: 'open_proposal_review',
        proposalId,
      },
    });
  }

  function renderSortButton(label: string, field: PBILibrarySortField) {
    const active = sortBy === field;
    const indicator = !active ? '' : sortDirection === 'asc' ? '↑' : '↓';

    return (
      <button
        type="button"
        className={`pbi-library-sort-btn${active ? ' is-active' : ''}`}
        onClick={() => handleSort(field)}
      >
        <span>{label}</span>
        <span className="pbi-library-sort-indicator" aria-hidden="true">{indicator}</span>
      </button>
    );
  }

  if (!activeWorkspace) {
    return (
      <>
        <PageHeader title="PBI Library" subtitle="No workspace selected" />
        <div className="route-content">
          <EmptyState
            icon={<IconArchive size={48} />}
            title="No workspace open"
            description="Open or create a workspace to search and inspect imported PBIs."
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="PBI Library"
        subtitle="Search and inspect uploaded PBIs across this workspace."
      />
      <div className="route-content pbi-library-page">
        {listQuery.loading && !listData ? (
          <LoadingState message="Loading PBI library..." />
        ) : listQuery.error && !listData ? (
          <ErrorState
            title="Failed to load PBI library"
            description={listQuery.error}
            action={(
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
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
                }}
              >
                Retry
              </button>
            )}
          />
        ) : items.length === 0 ? (
          <div className="pbi-library-surface">
            <div className="pbi-library-toolbar">
              <label className="pbi-library-search">
                <IconSearch size={16} className="pbi-library-search-icon" />
                <input
                  className="input"
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search by ID, title, description, batch, or source file"
                />
              </label>
              <select
                className="select"
                value={validationFilter}
                onChange={(event) => setValidationFilter(event.target.value as ValidationFilterValue)}
              >
                <option value="all">All validation</option>
                <option value={PBIValidationStatus.CANDIDATE}>Candidate</option>
                <option value={PBIValidationStatus.IGNORED}>Ignored</option>
                <option value={PBIValidationStatus.DUPLICATE}>Duplicate</option>
                <option value={PBIValidationStatus.MALFORMED}>Malformed</option>
              </select>
              <select
                className="select"
                value={scopeFilter}
                onChange={(event) => setScopeFilter(event.target.value as ScopeFilterValue)}
              >
                <option value="all">All scope</option>
                <option value="in_scope">In Scope</option>
                <option value="out_of_scope">Out of Scope</option>
                <option value="not_eligible">Not Eligible</option>
              </select>
              <select
                className="select"
                value={batchFilter}
                onChange={(event) => setBatchFilter(event.target.value)}
              >
                <option value="">All batches</option>
                {batchOptions.map((batch) => (
                  <option key={batch.id} value={batch.id}>{batch.name}</option>
                ))}
              </select>
            </div>
            <div className="card">
              <EmptyState
                icon={<IconArchive size={48} />}
                title="No PBIs match the current filters"
                description="Try a different search, adjust the scope filters, or import a new PBI batch."
              />
            </div>
          </div>
        ) : (
          <div className="pbi-library-surface">
            <div className="pbi-library-toolbar">
              <label className="pbi-library-search">
                <IconSearch size={16} className="pbi-library-search-icon" />
                <input
                  className="input"
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search by ID, title, description, batch, or source file"
                />
              </label>
              <select
                className="select"
                value={validationFilter}
                onChange={(event) => setValidationFilter(event.target.value as ValidationFilterValue)}
              >
                <option value="all">All validation</option>
                <option value={PBIValidationStatus.CANDIDATE}>Candidate</option>
                <option value={PBIValidationStatus.IGNORED}>Ignored</option>
                <option value={PBIValidationStatus.DUPLICATE}>Duplicate</option>
                <option value={PBIValidationStatus.MALFORMED}>Malformed</option>
              </select>
              <select
                className="select"
                value={scopeFilter}
                onChange={(event) => setScopeFilter(event.target.value as ScopeFilterValue)}
              >
                <option value="all">All scope</option>
                <option value="in_scope">In Scope</option>
                <option value="out_of_scope">Out of Scope</option>
                <option value="not_eligible">Not Eligible</option>
              </select>
              <select
                className="select"
                value={batchFilter}
                onChange={(event) => setBatchFilter(event.target.value)}
              >
                <option value="">All batches</option>
                {batchOptions.map((batch) => (
                  <option key={batch.id} value={batch.id}>{batch.name}</option>
                ))}
              </select>
            </div>

            <div className="card">
              <div className="pbi-library-table-header">
                <span>{items.length} PBIs</span>
                {listQuery.loading ? <span>Refreshing…</span> : null}
              </div>
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{renderSortButton('External ID', 'externalId')}</th>
                      <th>{renderSortButton('Title', 'title')}</th>
                      <th>{renderSortButton('Work Item Type', 'workItemType')}</th>
                      <th>{renderSortButton('Priority', 'priority')}</th>
                      <th>{renderSortButton('Validation', 'validationStatus')}</th>
                      <th>{renderSortButton('Scope', 'scopeState')}</th>
                      <th>{renderSortButton('Batch', 'batchName')}</th>
                      <th>{renderSortButton('Imported', 'importedAtUtc')}</th>
                      <th>{renderSortButton('Linked Proposals', 'proposalCount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr
                        key={item.pbiId}
                        ref={(node) => setRowRef(item.pbiId, node)}
                        className={`pbi-library-row${selectedPbiId === item.pbiId ? ' is-selected' : ''}`}
                        tabIndex={focusedPbiId === item.pbiId ? 0 : -1}
                        aria-selected={selectedPbiId === item.pbiId}
                        onClick={() => openViewer(item.pbiId)}
                        onFocus={() => setFocusedPbiId(item.pbiId)}
                        onKeyDown={(event) => handleRowKeyDown(event, index, item.pbiId)}
                      >
                        <td>
                          <code className="pbi-library-code">{item.externalId}</code>
                        </td>
                        <td>
                          <div className="pbi-library-title-cell">{item.title}</div>
                        </td>
                        <td>{item.workItemType || '—'}</td>
                        <td>
                          {item.priority ? (
                            <Badge variant={priorityBadgeVariant(item.priority)}>{formatTitleCase(item.priority)}</Badge>
                          ) : '—'}
                        </td>
                        <td>
                          <Badge variant={validationBadgeVariant(item.validationStatus)}>
                            {formatValidationLabel(item.validationStatus)}
                          </Badge>
                        </td>
                        <td>
                          <Badge variant={scopeBadgeVariant(item.scopeState)}>
                            {formatScopeLabel(item.scopeState)}
                          </Badge>
                        </td>
                        <td>
                          <div className="pbi-library-batch-cell">
                            <span>{item.batchName}</span>
                            <span>{item.sourceFileName}</span>
                          </div>
                        </td>
                        <td>{formatDateTime(item.importedAtUtc)}</td>
                        <td>{item.proposalCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <Drawer
        open={Boolean(selectedPbiId)}
        onClose={closeViewer}
        title={viewerItem?.title ?? 'PBI Viewer'}
        variant="fullscreen"
        customHeader={(
          <div className="article-detail-toolbar pbi-library-viewer-toolbar">
            <div className="article-detail-toolbar-top">
              <div className="pbi-library-viewer-heading">
                <div className="pbi-library-viewer-id">{viewerItem?.externalId ?? 'Loading PBI...'}</div>
                <div className="article-detail-title-group">
                  <div className="article-detail-title">{viewerItem?.title ?? 'Loading PBI...'}</div>
                  <div className="article-detail-badges">
                    {viewerItem ? (
                      <>
                        <Badge variant={validationBadgeVariant(viewerItem.validationStatus)}>
                          {formatValidationLabel(viewerItem.validationStatus)}
                        </Badge>
                        <Badge variant={scopeBadgeVariant(viewerItem.scopeState)}>
                          {formatScopeLabel(viewerItem.scopeState)}
                        </Badge>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
              <button type="button" className="btn btn-ghost btn-icon" onClick={closeViewer} aria-label="Close PBI viewer">
                <IconX size={16} />
              </button>
            </div>
          </div>
        )}
      >
        {detailQuery.loading && !detailData ? (
          <LoadingState message="Loading PBI details..." />
        ) : detailQuery.error && !detailData ? (
          <div className="pbi-library-viewer-body">
            <ErrorState
              title="Failed to load PBI details"
              description={detailQuery.error}
              action={(
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
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
                  }}
                >
                  Retry
                </button>
              )}
            />
          </div>
        ) : detailData ? (
          <div className="pbi-library-viewer-body">
            <section className="pbi-library-viewer-section">
              <div className="pbi-library-viewer-section-title">Overview</div>
              <div className="pbi-library-meta-grid">
                <div className="pbi-library-meta-item">
                  <span className="pbi-library-meta-label">Title hierarchy</span>
                  <span className="pbi-library-meta-value">
                    {detailData.titlePath.length > 0 ? detailData.titlePath.join(' / ') : detailData.record.title}
                  </span>
                </div>
                <div className="pbi-library-meta-item">
                  <span className="pbi-library-meta-label">Work item type</span>
                  <span className="pbi-library-meta-value">{detailData.record.workItemType || '—'}</span>
                </div>
                <div className="pbi-library-meta-item">
                  <span className="pbi-library-meta-label">Priority</span>
                  <span className="pbi-library-meta-value">{detailData.record.priority ? formatTitleCase(detailData.record.priority) : '—'}</span>
                </div>
                <div className="pbi-library-meta-item">
                  <span className="pbi-library-meta-label">Source row number</span>
                  <span className="pbi-library-meta-value">{detailData.record.sourceRowNumber}</span>
                </div>
                <div className="pbi-library-meta-item">
                  <span className="pbi-library-meta-label">Batch</span>
                  <span className="pbi-library-meta-value">{detailData.batch.name}</span>
                </div>
                <div className="pbi-library-meta-item">
                  <span className="pbi-library-meta-label">Import date</span>
                  <span className="pbi-library-meta-value">{formatDateTime(detailData.batch.importedAtUtc)}</span>
                </div>
              </div>
            </section>

            <section className="pbi-library-viewer-section">
              <div className="pbi-library-viewer-section-title">Metadata</div>
              <div className="pbi-library-meta-grid">
                <div className="pbi-library-meta-item">
                  <span className="pbi-library-meta-label">Validation status</span>
                  <span className="pbi-library-meta-value">{formatValidationLabel(detailData.item.validationStatus)}</span>
                </div>
                <div className="pbi-library-meta-item">
                  <span className="pbi-library-meta-label">Validation reason</span>
                  <span className="pbi-library-meta-value">{detailData.record.validationReason || '—'}</span>
                </div>
                <div className="pbi-library-meta-item">
                  <span className="pbi-library-meta-label">Scope state</span>
                  <span className="pbi-library-meta-value">{formatScopeLabel(detailData.item.scopeState)}</span>
                </div>
                <div className="pbi-library-meta-item">
                  <span className="pbi-library-meta-label">Parent external ID</span>
                  <span className="pbi-library-meta-value">{detailData.record.parentExternalId || '—'}</span>
                </div>
                <div className="pbi-library-meta-item pbi-library-meta-item--wide">
                  <span className="pbi-library-meta-label">Parent linked row</span>
                  <span className="pbi-library-meta-value">
                    {detailData.parent ? `${detailData.parent.externalId} — ${detailData.parent.title}` : '—'}
                  </span>
                </div>
                <div className="pbi-library-meta-item pbi-library-meta-item--wide">
                  <span className="pbi-library-meta-label">Child rows</span>
                  {detailData.children.length > 0 ? (
                    <div className="pbi-library-summary-list">
                      {detailData.children.map((child) => (
                        <div key={child.pbiId} className="pbi-library-summary-row">
                          <code className="pbi-library-code">{child.externalId}</code>
                          <span>{child.title}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="pbi-library-meta-value">No child rows.</span>
                  )}
                </div>
              </div>
            </section>

            <section className="pbi-library-viewer-section">
              <div className="pbi-library-viewer-section-title">Description</div>
              <div className="pbi-library-copy-block">
                {detailSectionCopy(detailData.record.descriptionText)}
              </div>
            </section>

            <section className="pbi-library-viewer-section">
              <div className="pbi-library-viewer-section-title">Acceptance Criteria</div>
              <div className="pbi-library-copy-block">
                {detailSectionCopy(detailData.record.acceptanceCriteriaText)}
              </div>
            </section>

            <section className="pbi-library-viewer-section">
              <div className="pbi-library-viewer-section-header">
                <div className="pbi-library-viewer-section-title">Source</div>
                <div className="pbi-library-toggle">
                  <button
                    type="button"
                    className={`pbi-library-toggle-btn${sourceViewMode === 'parsed' ? ' is-active' : ''}`}
                    onClick={() => setSourceViewMode('parsed')}
                  >
                    Parsed
                  </button>
                  <button
                    type="button"
                    className={`pbi-library-toggle-btn${sourceViewMode === 'raw' ? ' is-active' : ''}`}
                    onClick={() => setSourceViewMode('raw')}
                  >
                    Raw
                  </button>
                </div>
              </div>
              <div className="pbi-library-source-grid">
                <div className="pbi-library-source-block">
                  <div className="pbi-library-source-title">Description</div>
                  {sourceViewMode === 'raw' ? (
                    <pre className="pbi-library-pre">{detailSectionCopy(detailData.record.rawDescription)}</pre>
                  ) : (
                    <pre className="pbi-library-pre">{detailSectionCopy(detailData.record.descriptionText)}</pre>
                  )}
                </div>
                <div className="pbi-library-source-block">
                  <div className="pbi-library-source-title">Acceptance Criteria</div>
                  {sourceViewMode === 'raw' ? (
                    <pre className="pbi-library-pre">{detailSectionCopy(detailData.record.rawAcceptanceCriteria)}</pre>
                  ) : (
                    <pre className="pbi-library-pre">{detailSectionCopy(detailData.record.acceptanceCriteriaText)}</pre>
                  )}
                </div>
              </div>
            </section>

            <section className="pbi-library-viewer-section">
              <div className="pbi-library-viewer-section-title">Linked Proposals</div>
              {detailData.linkedProposals.length > 0 ? (
                <div className="pbi-library-linked-list">
                  {detailData.linkedProposals.map((proposal) => (
                    <div key={proposal.proposalId} className="pbi-library-linked-row">
                      <div className="pbi-library-linked-row-main">
                        <code className="pbi-library-code">{proposal.proposalId}</code>
                        <Badge variant={proposalActionBadgeVariant(proposal.action)}>
                          {formatTitleCase(proposal.action)}
                        </Badge>
                        <Badge variant={proposalStatusBadgeVariant(proposal.reviewStatus)}>
                          {formatTitleCase(proposal.reviewStatus)}
                        </Badge>
                      </div>
                      <div className="pbi-library-linked-row-meta">{formatDateTime(proposal.generatedAtUtc)}</div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => openProposalReview(proposal.proposalId)}
                      >
                        <IconArrowUpRight size={14} />
                        Open in Proposal Review
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="pbi-library-copy-block">No linked proposals.</div>
              )}
            </section>
          </div>
        ) : (
          <div className="pbi-library-viewer-body">
            <LoadingState message="Preparing viewer..." />
          </div>
        )}
      </Drawer>
    </>
  );
}
