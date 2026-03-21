import React from 'react';
import { AppRoute } from '@kb-vault/shared-types';
import {
  IconHome,
  IconFolder,
  IconUpload,
  IconCheckCircle,
  IconGitBranch,
  IconSend,
  IconLayout,
  IconSettings,
  IconChevronDown,
} from './icons';

interface SidebarProps {
  activeRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
  workspaceName?: string;
  isConnected?: boolean;
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
  { id: AppRoute.PBI_BATCHES,     label: 'PBI Batches',     icon: <IconUpload /> },
  { id: AppRoute.PROPOSAL_REVIEW, label: 'Proposal Review', icon: <IconCheckCircle /> },
  { id: AppRoute.DRAFTS,          label: 'Drafts',          icon: <IconGitBranch /> },
  { id: AppRoute.PUBLISH_QUEUE,   label: 'Publish Queue',   icon: <IconSend /> },
];

const toolsNav: NavItem[] = [
  { id: AppRoute.TEMPLATES_AND_PROMPTS, label: 'Templates & Prompts', icon: <IconLayout /> },
  { id: AppRoute.SETTINGS,              label: 'Settings',            icon: <IconSettings /> },
];

export function Sidebar({ activeRoute, onNavigate, workspaceName, isConnected }: SidebarProps) {
  return (
    <aside className="sidebar" role="navigation" aria-label="Main navigation">
      {/* Logo */}
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon" aria-hidden="true">KB</div>
          <span className="sidebar-logo-text">KB Vault</span>
        </div>
      </div>

      {/* Workspace selector */}
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

      {/* Main navigation */}
      <nav className="sidebar-nav">
        <div className="nav-section">
          <div className="nav-section-label">Workflow</div>
          {mainNav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activeRoute === item.id ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
              aria-current={activeRoute === item.id ? 'page' : undefined}
            >
              <span className="nav-item-icon">{item.icon}</span>
              <span className="nav-item-label">{item.label}</span>
              {item.badge && <span className="nav-item-badge">{item.badge}</span>}
            </button>
          ))}
        </div>

        <div className="nav-section" style={{ marginTop: 'var(--space-2)' }}>
          <div className="nav-section-label">Tools</div>
          {toolsNav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activeRoute === item.id ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
              aria-current={activeRoute === item.id ? 'page' : undefined}
            >
              <span className="nav-item-icon">{item.icon}</span>
              <span className="nav-item-label">{item.label}</span>
            </button>
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
          <span style={{ fontSize: 'var(--text-xs)', opacity: 0.6 }}>
            {isConnected ? 'Connected' : 'Offline'}
          </span>
        </div>
      </div>
    </aside>
  );
}
