"use client";

export type JarvisSurface = "conversation" | "files" | "devices";

export function JarvisPrimaryNav({
  active,
  onChange,
  onActivity,
}: {
  active: JarvisSurface;
  onChange: (surface: JarvisSurface) => void;
  onActivity: () => void;
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-cyan-400/15 bg-black/95 px-[max(8px,env(safe-area-inset-left))] pb-[env(safe-area-inset-bottom)] backdrop-blur xl:left-auto xl:right-4 xl:bottom-4 xl:w-[420px] xl:rounded-xl xl:border"
      aria-label="Navegação principal"
    >
      <button type="button" aria-current={active === "conversation" ? "page" : undefined} onClick={() => onChange("conversation")} className="min-h-12 px-2 text-xs text-ink-1">Conversa</button>
      <button type="button" aria-current={active === "files" ? "page" : undefined} onClick={() => onChange("files")} className="min-h-12 px-2 text-xs text-ink-1">Arquivos</button>
      <button type="button" onClick={onActivity} className="min-h-12 px-2 text-xs text-ink-1">Atividades</button>
      <button type="button" aria-current={active === "devices" ? "page" : undefined} onClick={() => onChange("devices")} className="min-h-12 px-2 text-xs text-ink-1">Dispositivos</button>
    </nav>
  );
}
