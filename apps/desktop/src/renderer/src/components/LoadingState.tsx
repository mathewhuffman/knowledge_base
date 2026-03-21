interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = 'Loading...' }: LoadingStateProps) {
  return (
    <div className="loading-state">
      <div className="spinner" />
      <span className="loading-state-text">{message}</span>
    </div>
  );
}
