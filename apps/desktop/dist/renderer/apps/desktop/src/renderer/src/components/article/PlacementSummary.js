import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
function normalizeLabel(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}
function resolveCategoryLabel(placement) {
    return normalizeLabel(placement?.categoryName) ?? normalizeLabel(placement?.categoryId);
}
function resolveSectionLabel(placement) {
    return normalizeLabel(placement?.sectionName) ?? normalizeLabel(placement?.sectionId);
}
function placementsDiffer(current, suggested) {
    if (!current && !suggested) {
        return false;
    }
    return resolveCategoryLabel(current) !== resolveCategoryLabel(suggested)
        || resolveSectionLabel(current) !== resolveSectionLabel(suggested)
        || normalizeLabel(suggested?.notes) !== null
        || normalizeLabel(suggested?.articleTitle) !== null;
}
function PlacementGroup({ label, placement, emphasized, articleTitle, notes, }) {
    const categoryLabel = resolveCategoryLabel(placement);
    const sectionLabel = resolveSectionLabel(placement);
    return (_jsxs("div", { className: `placement-summary-group${emphasized ? ' placement-summary-group--emphasized' : ''}`, children: [_jsx("div", { className: "placement-summary-group-header", children: _jsx("span", { className: "placement-summary-group-label", children: label }) }), articleTitle && (_jsx("div", { className: "placement-summary-eyebrow", children: articleTitle })), _jsxs("div", { className: "placement-summary-chip-row", children: [_jsxs("div", { className: `placement-summary-chip${categoryLabel ? '' : ' placement-summary-chip--missing'}`, children: [_jsx("span", { className: "placement-summary-chip-kind", children: "Category" }), _jsx("span", { className: "placement-summary-chip-value", children: categoryLabel ?? 'Not set' })] }), _jsxs("div", { className: "placement-summary-chip", children: [_jsx("span", { className: "placement-summary-chip-kind", children: "Section" }), _jsx("span", { className: "placement-summary-chip-value", children: sectionLabel ?? 'No section' })] })] }), notes && (_jsx("div", { className: "placement-summary-note", children: notes }))] }));
}
export function PlacementSummary({ current, suggested, emptyMessage = 'No category or section metadata is set yet.', }) {
    const hasCurrent = Boolean(current && (resolveCategoryLabel(current) || resolveSectionLabel(current)));
    const hasSuggested = Boolean(suggested
        && (resolveCategoryLabel(suggested)
            || resolveSectionLabel(suggested)
            || normalizeLabel(suggested.notes)
            || normalizeLabel(suggested.articleTitle)));
    const showSuggested = hasSuggested && placementsDiffer(current, suggested);
    if (!hasCurrent && !hasSuggested) {
        return _jsx("div", { className: "placement-summary-empty", children: emptyMessage });
    }
    return (_jsxs("div", { className: "placement-summary", children: [hasCurrent && current && (_jsx(PlacementGroup, { label: showSuggested ? 'Current' : 'Location', placement: current })), showSuggested && suggested && (_jsx(PlacementGroup, { label: hasCurrent ? 'Suggested' : 'Proposed', placement: suggested, emphasized: true, articleTitle: normalizeLabel(suggested.articleTitle), notes: normalizeLabel(suggested.notes) })), !hasCurrent && hasSuggested && suggested && !showSuggested && (_jsx(PlacementGroup, { label: "Location", placement: suggested, emphasized: true, articleTitle: normalizeLabel(suggested.articleTitle), notes: normalizeLabel(suggested.notes) }))] }));
}
