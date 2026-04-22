import type { AppUpdateState } from '@kb-vault/shared-types';
import { Modal } from './Modal';
import { Badge } from './Badge';
import { IconAlertCircle, IconCheckCircle, IconRefreshCw } from './icons';
import { isMacPlatform } from '../utils/platform';

interface AppUpdateModalProps {
  open: boolean;
  state: AppUpdateState | null;
  onClose: () => void;
  onDownload: () => void;
  onRestartAndInstall: () => void;
}

function buildTitle(state: AppUpdateState | null): string {
  if (state?.errorMessage && state.status !== 'downloading' && state.status !== 'downloaded') {
    return 'Update needs attention';
  }

  switch (state?.status) {
    case 'downloading':
      return 'Downloading update';
    case 'downloaded':
      return 'Update ready';
    case 'error':
      return 'Update error';
    default:
      return 'Update available';
  }
}

export function AppUpdateModal({
  open,
  state,
  onClose,
  onDownload,
  onRestartAndInstall
}: AppUpdateModalProps) {
  if (!open || !state || !state.updateInfo) {
    return null;
  }

  const isMac = isMacPlatform();
  const footer = (
    <div className="update-modal__footer">
      <button className="btn btn-secondary" onClick={onClose}>
        {state.status === 'downloaded' ? 'Later' : 'Hide'}
      </button>
      {state.status === 'downloaded' ? (
        <button className="btn btn-primary" onClick={onRestartAndInstall}>
          {isMac ? 'Quit and Install' : 'Restart and Install'}
        </button>
      ) : (
        <button
          className="btn btn-primary"
          onClick={onDownload}
          disabled={state.status === 'downloading'}
        >
          {state.status === 'downloading'
            ? 'Downloading...'
            : state.errorMessage
              ? 'Download Again'
              : 'Download Update'}
        </button>
      )}
    </div>
  );

  const badgeVariant = state.status === 'downloaded'
    ? 'success'
    : state.status === 'error'
      ? 'danger'
      : state.errorMessage
        ? 'warning'
        : 'primary';
  const badgeLabel = state.status === 'downloaded'
    ? 'Ready to install'
    : state.status === 'downloading'
      ? 'Downloading'
      : state.errorMessage
        ? 'Needs attention'
        : 'Available';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={buildTitle(state)}
      footer={footer}
      className="update-modal"
    >
      <div className="update-modal__body">
        <div className="update-modal__summary">
          <div className="update-modal__summary-head">
            <div>
              <div className="update-modal__version-line">
                <span className="update-modal__version-label">Current</span>
                <strong>{state.currentVersion}</strong>
              </div>
              <div className="update-modal__version-line">
                <span className="update-modal__version-label">Available</span>
                <strong>{state.updateInfo.version}</strong>
              </div>
            </div>
            <Badge variant={badgeVariant}>
              {badgeLabel}
            </Badge>
          </div>

          {state.updateInfo.releaseName ? (
            <div className="update-modal__release-name">{state.updateInfo.releaseName}</div>
          ) : null}

          {state.updateInfo.releaseDate ? (
            <div className="update-modal__release-date">
              Released {new Date(state.updateInfo.releaseDate).toLocaleString()}
            </div>
          ) : null}
        </div>

        {state.status === 'downloading' && (
          <div className="update-modal__progress">
            <div className="progress-bar">
              <div
                className="progress-bar-fill"
                style={{ width: `${state.downloadProgressPercent ?? 0}%` }}
              />
            </div>
            <div className="update-modal__progress-text">
              <IconRefreshCw size={14} />
              <span>{state.downloadProgressPercent ?? 0}% downloaded</span>
            </div>
          </div>
        )}

        {state.status === 'downloaded' && (
          <div className="update-modal__status update-modal__status--success">
            <IconCheckCircle size={16} />
            <span>
              {isMac
                ? "The update is ready. KnowledgeBase will close to install it. If it doesn't reopen automatically, open it from /Applications."
                : 'The update is ready. Restart KnowledgeBase when you want to install it.'}
            </span>
          </div>
        )}

        {state.errorMessage && (
          <div className="update-modal__status update-modal__status--error">
            <IconAlertCircle size={16} />
            <span className="update-copyable-text">{state.errorMessage}</span>
          </div>
        )}

        <div className="update-modal__notes">
          <div className="update-modal__notes-heading">What's new</div>
          {state.updateInfo.releaseNotes.length > 0 ? (
            <div className="update-modal__notes-list">
              {state.updateInfo.releaseNotes.map((entry, index) => (
                <div key={`${entry.version ?? 'note'}-${index}`} className="update-modal__note">
                  {entry.version ? (
                    <div className="update-modal__note-version">Version {entry.version}</div>
                  ) : null}
                  <pre className="update-modal__note-text">{entry.note}</pre>
                </div>
              ))}
            </div>
          ) : (
            <div className="update-modal__notes-empty">
              No release notes were provided for this update.
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
