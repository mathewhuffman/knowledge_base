# Design Handoff — Batch 1

**Date:** 2026-03-21

## Design decisions

### Color system
- Dark sidebar (#1a1d23) with light content (#ffffff) — provides clear visual hierarchy and matches modern desktop app conventions (VS Code, Linear, Notion)
- Blue primary (#228be6) used for active states, primary buttons, and accent indicators
- Status colors: green for success/live, yellow/orange for warning/pending, red for danger/conflicted, gray for neutral/retired

### Typography
- Inter as primary font, system fallbacks
- Desktop-optimized sizing: 13px base, 12px for secondary text, 11px for labels/badges
- Tight size scale prevents visual noise in dense information layouts

### Sidebar design
- 240px fixed width dark sidebar
- Two navigation sections: "Workflow" (6 items) and "Tools" (2 items)
- Active state: subtle background highlight + 3px blue left accent bar
- Section labels in uppercase 11px for clear grouping
- Workspace selector near top as a clickable button with status dot

### Page structure
- Every page follows: PageHeader (title + subtitle + actions) → scrollable content area
- Headers are sticky at page top with bottom border separator
- Content padding is 24px (var(--space-6))

### Component patterns
- Cards with 1px border, 8px radius, optional hover state for interactive cards
- Badges as inline pills with colored backgrounds
- Status chips as dot + label for article/branch lifecycle states
- Tables with uppercase 11px headers, hover highlight on rows

## Open questions for future batches
- Should sidebar collapse to icon-only on small windows?
- Should workspace switcher be a dropdown popover or always navigate to the full page?
- Should we add a notification/toast system for sync/publish events?
