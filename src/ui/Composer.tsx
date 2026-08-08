"use client";

interface ComposerProps {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

const HINTS = [
  "/select model gemini",
  "/select model codex",
  "/select model deepseek-flash",
  "/skills list",
  "/skill use sdk",
  "/skill clear",
  "/voice on",
  "/voice off",
  "/voice status",
  "/speak",
];

export function Composer({ value, disabled, onChange, onSubmit }: ComposerProps) {
  return (
    <form
      className="border-t border-surface-2 bg-surface-1 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex gap-2">
        <input
          id="jarvis-composer"
          className="flex-1 rounded-md border border-surface-2 bg-surface-0 px-3 py-2 text-sm text-ink-0 outline-none focus-visible:border-accent-listen focus-visible:ring-2 focus-visible:ring-accent-listen/40"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="fale, ou escreva…"
          aria-label="Compositor"
          list="slash-hints"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="rounded-md bg-accent-listen px-4 py-2 text-sm font-medium text-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-listen disabled:opacity-40"
        >
          Enviar
        </button>
      </div>
      <p className="mt-2 font-mono text-[11px] text-ink-2">
        hist ^H · voz ^V · ouvir ^L · cancelar Esc
      </p>
      <datalist id="slash-hints">
        {HINTS.map((h) => (
          <option key={h} value={h} />
        ))}
      </datalist>
    </form>
  );
}
