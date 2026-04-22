import React, { useState, useRef, useEffect } from 'react';
import { AppRoute } from '@kb-vault/shared-types';
import {
  IconHome,
  IconFolder,
  IconUpload,
  IconArchive,
  IconCheckCircle,
  IconGitBranch,
  IconLayers,
  IconSend,
  IconLayout,
  IconSettings,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
} from './icons';

interface SidebarProps {
  activeRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
  workspaceName?: string;
  isConnected?: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

interface NavItem {
  id: AppRoute;
  label: string;
  icon: React.ReactNode;
  badge?: string;
}

const mainNav: NavItem[] = [
  { id: AppRoute.KB_VAULT_HOME,   label: 'Home',            icon: <IconHome /> },
  { id: AppRoute.ARTICLE_EXPLORER, label: 'Articles',       icon: <IconFolder /> },
  { id: AppRoute.RELATIONS_GRAPH, label: 'Feature Map', icon: <IconLayers /> },
  { id: AppRoute.PBI_BATCHES,     label: 'PBI Batches',     icon: <IconUpload /> },
  { id: AppRoute.PBI_LIBRARY,     label: 'PBI Library',     icon: <IconArchive /> },
  { id: AppRoute.PROPOSAL_REVIEW, label: 'Proposal Review', icon: <IconCheckCircle /> },
  { id: AppRoute.DRAFTS,          label: 'Drafts',          icon: <IconGitBranch /> },
  { id: AppRoute.PUBLISH_QUEUE,   label: 'Publish Queue',   icon: <IconSend /> },
];

const toolsNav: NavItem[] = [
  { id: AppRoute.TEMPLATES_AND_PROMPTS, label: 'Templates & Prompts', icon: <IconLayout /> },
  { id: AppRoute.SETTINGS,              label: 'Settings',            icon: <IconSettings /> },
];

/* Tiny tooltip that appears on hover when the sidebar is collapsed */
function NavTooltip({ label, anchorRef }: { label: string; anchorRef: React.RefObject<HTMLButtonElement | null> }) {
  const [pos, setPos] = useState({ top: 0, visible: false });

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.top + rect.height / 2, visible: true });
  }, [anchorRef]);

  if (!pos.visible) return null;

  return (
    <div
      className="sidebar-tooltip"
      style={{ top: pos.top }}
    >
      {label}
    </div>
  );
}

function CollapsibleNavItem({
  item,
  isActive,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  onNavigate: (route: AppRoute) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={ref}
        className={`nav-item ${isActive ? 'active' : ''} ${collapsed ? 'nav-item--collapsed' : ''}`}
        onClick={() => onNavigate(item.id)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-current={isActive ? 'page' : undefined}
        aria-label={collapsed ? item.label : undefined}
      >
        <span className="nav-item-icon">{item.icon}</span>
        <span className="nav-item-label">{item.label}</span>
        {item.badge && <span className="nav-item-badge">{item.badge}</span>}
      </button>
      {collapsed && hovered && <NavTooltip label={item.label} anchorRef={ref} />}
    </>
  );
}

export function Sidebar({ activeRoute, onNavigate, workspaceName, isConnected, collapsed, onToggleCollapse }: SidebarProps) {
  const [hasToggled, setHasToggled] = useState(false);

  // Track that the user has toggled at least once (prevents animation on mount)
  const handleToggle = () => {
    if (!hasToggled) setHasToggled(true);
    onToggleCollapse();
  };

  return (
    <>
      <aside
        className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}
        role="navigation"
        aria-label="Main navigation"
        data-has-toggled={hasToggled || undefined}
      >
        {/* SVG goo filter — applied to the sidebar edge for the blobby morph */}
        <svg className="sidebar-goo-defs" aria-hidden="true">
          <defs>
            <filter id="goo-filter">
              <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
              <feColorMatrix
                in="blur"
                mode="matrix"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
                result="goo"
              />
              <feComposite in="SourceGraphic" in2="goo" operator="atop" />
            </filter>
          </defs>
        </svg>

        {/* Header with logo */}
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon" aria-hidden="true">KB</div>
            <span className="sidebar-logo-text">KnowledgeBase</span>
          </div>
        </div>

        {!collapsed ? (
          <button
            className="workspace-selector"
            onClick={() => onNavigate(AppRoute.WORKSPACE_SWITCHER)}
            aria-label="Switch workspace"
          >
            <span
              className="workspace-selector-dot"
              style={{ background: isConnected ? undefined : 'var(--gray-500)' }}
            />
            <span className="workspace-selector-name">
              {workspaceName || 'No workspace'}
            </span>
            <IconChevronDown size={12} className="workspace-selector-chevron" />
          </button>
        ) : null}

        {/* Main navigation */}
        <nav className="sidebar-nav">
          <div className="nav-section">
            <div className="nav-section-label">Workflow</div>
            {mainNav.map((item) => (
              <CollapsibleNavItem
                key={item.id}
                item={item}
                isActive={activeRoute === item.id}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </div>

          <div className="nav-section" style={{ marginTop: 'var(--space-2)' }}>
            <div className="nav-section-label">Tools</div>
            {toolsNav.map((item) => (
              <CollapsibleNavItem
                key={item.id}
                item={item}
                isActive={activeRoute === item.id}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </nav>

        {/* Footer status */}
        <div className="sidebar-footer">
          <div className="sidebar-footer-item">
            <span
              className="status-chip-dot"
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: isConnected ? 'var(--color-success)' : 'var(--gray-500)',
              }}
            />
            <span className="sidebar-footer-label" style={{ fontSize: 'var(--text-xs)', opacity: 0.6 }}>
              {isConnected ? 'Connected' : 'Offline'}
            </span>
          </div>
        </div>
      </aside>

      {/* Collapse toggle — rendered outside aside so it isn't clipped by overflow */}
      <button
        className={`sidebar-collapse-btn ${collapsed ? 'sidebar-collapse-btn--collapsed' : ''}`}
        onClick={handleToggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <IconChevronRight size={18} /> : <IconChevronLeft size={18} />}
      </button>
    </>
  );
}
