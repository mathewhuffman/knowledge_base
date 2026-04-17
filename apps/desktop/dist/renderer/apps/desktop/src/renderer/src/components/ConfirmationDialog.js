import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Modal } from './Modal';
import { IconAlertCircle } from './icons';
export function ConfirmationDialog({ open, title, message, confirmText = 'Confirm', cancelText = 'Cancel', isProcessing = false, variant = 'danger', onClose, onConfirm }) {
    const confirmClass = `btn ${variant === 'danger' ? 'btn-danger' : 'btn-primary'} confirmation-dialog__footer-btn`;
    const footer = (_jsxs("div", { className: "confirmation-dialog__footer", children: [_jsx("button", { className: "btn btn-secondary", onClick: onClose, disabled: isProcessing, children: cancelText }), _jsx("button", { className: confirmClass, onClick: () => void onConfirm(), disabled: isProcessing, children: isProcessing ? 'Working...' : confirmText })] }));
    return (_jsx(Modal, { open: open, onClose: onClose, title: title, className: "confirmation-dialog", footer: footer, children: _jsxs("div", { className: "confirmation-dialog__body", children: [_jsx("div", { className: "confirmation-dialog__icon", "aria-hidden": "true", children: _jsx(IconAlertCircle, { size: 18 }) }), _jsx("div", { className: "confirmation-dialog__content", children: _jsx("div", { className: "confirmation-dialog__message", children: message }) })] }) }));
}
