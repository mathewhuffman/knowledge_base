import { AppRoute } from '@kb-vault/shared-types';
import { ArticleExplorer } from '../pages/ArticleExplorer';
import { KBVaultHome } from '../pages/KBVaultHome';
import { PBI } from '../pages/PBIBatches';
import { ProposalReview } from '../pages/ProposalReview';
import { Drafts } from '../pages/Drafts';
import { PublishQueue } from '../pages/PublishQueue';
import { TemplatesAndPrompts } from '../pages/TemplatesAndPrompts';
import { Settings } from '../pages/Settings';
import { WorkspaceSwitcher } from '../pages/WorkspaceSwitcher';
import type { FunctionComponent } from 'react';

export const routeToComponent: Record<AppRoute, FunctionComponent> = {
  [AppRoute.WORKSPACE_SWITCHER]: WorkspaceSwitcher,
  [AppRoute.KB_VAULT_HOME]: KBVaultHome,
  [AppRoute.ARTICLE_EXPLORER]: ArticleExplorer,
  [AppRoute.PBI_BATCHES]: PBI,
  [AppRoute.PROPOSAL_REVIEW]: ProposalReview,
  [AppRoute.DRAFTS]: Drafts,
  [AppRoute.PUBLISH_QUEUE]: PublishQueue,
  [AppRoute.TEMPLATES_AND_PROMPTS]: TemplatesAndPrompts,
  [AppRoute.SETTINGS]: Settings
};
