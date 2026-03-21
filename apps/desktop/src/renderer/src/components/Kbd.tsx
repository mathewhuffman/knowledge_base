interface KbdProps {
  keys: string;
}

export function Kbd({ keys }: KbdProps) {
  const parts = keys.split('+');
  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {parts.map((key, i) => (
        <span key={i}>
          <kbd className="kbd">{key}</kbd>
          {i < parts.length - 1 && <span style={{ fontSize: 10, color: 'var(--gray-400)', margin: '0 1px' }}>+</span>}
        </span>
      ))}
    </span>
  );
}
