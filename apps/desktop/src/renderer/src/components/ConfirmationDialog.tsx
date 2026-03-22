import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { IconAlertCircle } from './icons';

interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  isProcessing?: boolean;
  variant?: 'danger' | 'primary';
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}

export function ConfirmationDialog({
  open,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isProcessing = false,
  variant = 'danger',
  onClose,
  onConfirm
}: ConfirmationDialogProps) {
  const confirmClass = `btn ${variant === 'danger' ? 'btn-danger' : 'btn-primary'} confirmation-dialog__footer-btn`;
  const footer = (
    <div className="confirmation-dialog__footer">
      <button className="btn btn-secondary" onClick={onClose} disabled={isProcessing}>
        {cancelText}
      </button>
      <button className={confirmClass} onClick={() => void onConfirm()} disabled={isProcessing}>
        {isProcessing ? 'Working...' : confirmText}
      </button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      className="confirmation-dialog"
      footer={footer}
    >
      <div className="confirmation-dialog__body">
        <div className="confirmation-dialog__icon" aria-hidden="true">
          <IconAlertCircle size={18} />
        </div>
        <div className="confirmation-dialog__content">
          <div className="confirmation-dialog__message">{message}</div>
        </div>
      </div>
    </Modal>
  );
}
