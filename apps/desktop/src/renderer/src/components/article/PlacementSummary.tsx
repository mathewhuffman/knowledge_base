import type { ArticlePlacementSummary, ProposalPlacementSuggestion } from '@kb-vault/shared-types';

function normalizeLabel(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveCategoryLabel(placement?: ArticlePlacementSummary | ProposalPlacementSuggestion): string | null {
  return normalizeLabel(placement?.categoryName) ?? normalizeLabel(placement?.categoryId);
}

function resolveSectionLabel(placement?: ArticlePlacementSummary | ProposalPlacementSuggestion): string | null {
  return normalizeLabel(placement?.sectionName) ?? normalizeLabel(placement?.sectionId);
}

function placementsDiffer(
  current?: ArticlePlacementSummary,
  suggested?: ProposalPlacementSuggestion
): boolean {
  if (!current && !suggested) {
    return false;
  }
  return resolveCategoryLabel(current) !== resolveCategoryLabel(suggested)
    || resolveSectionLabel(current) !== resolveSectionLabel(suggested)
    || normalizeLabel(suggested?.notes) !== null
    || normalizeLabel(suggested?.articleTitle) !== null;
}

function PlacementGroup({
  label,
  placement,
  emphasized,
  articleTitle,
  notes,
}: {
  label: string;
  placement: ArticlePlacementSummary | ProposalPlacementSuggestion;
  emphasized?: boolean;
  articleTitle?: string | null;
  notes?: string | null;
}) {
  const categoryLabel = resolveCategoryLabel(placement);
  const sectionLabel = resolveSectionLabel(placement);

  return (
    <div className={`placement-summary-group${emphasized ? ' placement-summary-group--emphasized' : ''}`}>
      <div className="placement-summary-group-header">
        <span className="placement-summary-group-label">{label}</span>
      </div>
      {articleTitle && (
        <div className="placement-summary-eyebrow">{articleTitle}</div>
      )}
      <div className="placement-summary-chip-row">
        <div className={`placement-summary-chip${categoryLabel ? '' : ' placement-summary-chip--missing'}`}>
          <span className="placement-summary-chip-kind">Category</span>
          <span className="placement-summary-chip-value">{categoryLabel ?? 'Not set'}</span>
        </div>
        <div className="placement-summary-chip">
          <span className="placement-summary-chip-kind">Section</span>
          <span className="placement-summary-chip-value">{sectionLabel ?? 'No section'}</span>
        </div>
      </div>
      {notes && (
        <div className="placement-summary-note">{notes}</div>
      )}
    </div>
  );
}

export function PlacementSummary({
  current,
  suggested,
  emptyMessage = 'No category or section metadata is set yet.',
}: {
  current?: ArticlePlacementSummary;
  suggested?: ProposalPlacementSuggestion;
  emptyMessage?: string;
}) {
  const hasCurrent = Boolean(current && (resolveCategoryLabel(current) || resolveSectionLabel(current)));
  const hasSuggested = Boolean(
    suggested
    && (
      resolveCategoryLabel(suggested)
      || resolveSectionLabel(suggested)
      || normalizeLabel(suggested.notes)
      || normalizeLabel(suggested.articleTitle)
    )
  );
  const showSuggested = hasSuggested && placementsDiffer(current, suggested);

  if (!hasCurrent && !hasSuggested) {
    return <div className="placement-summary-empty">{emptyMessage}</div>;
  }

  return (
    <div className="placement-summary">
      {hasCurrent && current && (
        <PlacementGroup
          label={showSuggested ? 'Current' : 'Location'}
          placement={current}
        />
      )}
      {showSuggested && suggested && (
        <PlacementGroup
          label={hasCurrent ? 'Suggested' : 'Proposed'}
          placement={suggested}
          emphasized
          articleTitle={normalizeLabel(suggested.articleTitle)}
          notes={normalizeLabel(suggested.notes)}
        />
      )}
      {!hasCurrent && hasSuggested && suggested && !showSuggested && (
        <PlacementGroup
          label="Location"
          placement={suggested}
          emphasized
          articleTitle={normalizeLabel(suggested.articleTitle)}
          notes={normalizeLabel(suggested.notes)}
        />
      )}
    </div>
  );
}
