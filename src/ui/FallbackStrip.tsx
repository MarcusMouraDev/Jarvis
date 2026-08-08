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
      className="w-full max-w-[65ch] rounded-md border border-fallback/35 bg-surface-1/90 px-3 py-2 text-center text-xs text-fallback sm:text-sm"
      role="status"
    >
      Fallback ativo: pedido{" "}
      <span className="font-mono whitespace-nowrap">{requestedAlias}</span> →
      efetivo{" "}
      <span className="font-mono whitespace-nowrap">{effectiveAlias}</span>
      {reason ? ` (${reason})` : null}
    </div>
  );
}
