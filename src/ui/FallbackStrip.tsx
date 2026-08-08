interface FallbackStripProps {
  visible: boolean;
  requestedAlias: string;
  effectiveAlias: string;
  reason?: string;
}

export function FallbackStrip({
  visible,
  requestedAlias,
  effectiveAlias,
  reason,
}: FallbackStripProps) {
  if (!visible) return null;

  return (
    <div
      className="border border-fallback/40 bg-surface-1 px-3 py-2 text-sm text-fallback"
      role="status"
    >
      Fallback ativo: pedido <span className="font-mono">{requestedAlias}</span> →
      efetivo <span className="font-mono">{effectiveAlias}</span>
      {reason ? ` (${reason})` : null}
    </div>
  );
}
