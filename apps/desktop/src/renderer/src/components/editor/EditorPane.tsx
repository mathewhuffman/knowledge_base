import type { ReactNode } from 'react';

type EditorPaneProps = {
  children: ReactNode;
  footerStart?: ReactNode;
  footerEnd?: ReactNode;
  className?: string;
};

export function EditorPane({ children, footerStart, footerEnd, className }: EditorPaneProps) {
  return (
    <div className={`editor-pane ${className ?? ''}`.trim()}>
      <div className="editor-pane__body">{children}</div>
      {(footerStart || footerEnd) && (
        <div className="editor-pane__footer">
          <div className="editor-pane__footer-start">{footerStart}</div>
          <div className="editor-pane__footer-end">{footerEnd}</div>
        </div>
      )}
    </div>
  );
}
