type StatusType = 'live' | 'draft' | 'conflicted' | 'retired' | 'pending' | 'active';

interface StatusChipProps {
  status: StatusType;
  label?: string;
}

const defaultLabels: Record<StatusType, string> = {
  live: 'Live',
  draft: 'Draft',
  conflicted: 'Conflicted',
  retired: 'Retired',
  pending: 'Pending',
  active: 'Active',
};

export function StatusChip({ status, label }: StatusChipProps) {
  return (
    <span className="status-chip">
      <span className={`status-chip-dot ${status}`} />
      <span>{label || defaultLabels[status]}</span>
    </span>
  );
}
