"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type HudMenuOption = {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
};

type PanelBox = { top: number; left: number; width: number; maxHeight: number };

const OPEN_EVENT = "jarvis-hud-open";

export function HudMenu({
  kicker,
  value,
  placeholder = "escolher",
  options,
  disabled = false,
  onChange,
  ariaLabel,
  openSignal = 0,
}: {
  kicker: string;
  value?: string;
  placeholder?: string;
  options: readonly HudMenuOption[];
  disabled?: boolean;
  onChange: (id: string) => void;
  ariaLabel: string;
  openSignal?: number;
}) {
  const listId = useId();
  const instanceId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<PanelBox | null>(null);

  const selected = options.find((option) => option.id === value);
  const face = selected?.label ?? placeholder;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration marker prevents SSR mismatch.
    setMounted(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const openMenu = useCallback(() => {
    if (disabled || options.length === 0) return;
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: instanceId }));
    const index = Math.max(
      0,
      options.findIndex((option) => option.id === value && !option.disabled),
    );
    setActive(index < 0 ? 0 : index);
    setOpen(true);
  }, [disabled, instanceId, options, value]);

  useEffect(() => {
    const onPeer = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail !== instanceId) setOpen(false);
    };
    window.addEventListener(OPEN_EVENT, onPeer);
    return () => window.removeEventListener(OPEN_EVENT, onPeer);
  }, [instanceId]);

  const signalRef = useRef(openSignal);
  useEffect(() => {
    if (openSignal === 0 || openSignal === signalRef.current) {
      signalRef.current = openSignal;
      return;
    }
    signalRef.current = openSignal;
    openMenu();
  }, [openMenu, openSignal]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = buttonRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 228), window.innerWidth - 16);
      const estimated = Math.min(options.length * 40 + 16, window.innerHeight * 0.45);
      const below = rect.bottom + 8;
      const flip = below + estimated > window.innerHeight - 8;
      const top = flip ? Math.max(8, rect.top - 8 - estimated) : below;
      let left = rect.left;
      if (left + width > window.innerWidth - 8) {
        left = window.innerWidth - width - 8;
      }
      if (left < 8) left = 8;
      setBox({
        top,
        left,
        width,
        maxHeight: Math.min(320, window.innerHeight - top - 8),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [close, open]);

  const commit = (option: HudMenuOption) => {
    if (option.disabled) return;
    onChange(option.id);
    close();
    buttonRef.current?.focus();
  };

  const panel =
    mounted && open && box
      ? createPortal(
          <div
            ref={panelRef}
            id={listId}
            className="hud-menu__panel"
            role="listbox"
            aria-label={ariaLabel}
            style={{
              top: box.top,
              left: box.left,
              width: box.width,
              maxHeight: box.maxHeight,
            }}
          >
            {options.map((option, index) => {
              const isActive = index === active;
              const isSelected = option.id === value;
              return (
                <button
                  key={option.id}
                  id={`${listId}-opt-${index}`}
                  type="button"
                  role="option"
                  disabled={option.disabled}
                  aria-selected={isSelected}
                  className="hud-menu__option"
                  data-active={isActive ? "true" : "false"}
                  data-selected={isSelected ? "true" : "false"}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => commit(option)}
                >
                  <i aria-hidden className="hud-menu__pip" />
                  <span className="hud-menu__option-label">{option.label}</span>
                  {option.hint ? (
                    <kbd className="hud-menu__hint">{option.hint}</kbd>
                  ) : null}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="hud-menu" data-open={open ? "true" : "false"}>
      <button
        ref={buttonRef}
        type="button"
        className="hud-menu__face"
        disabled={disabled || options.length === 0}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            if (!open) {
              event.preventDefault();
              openMenu();
            }
          }
          if (!open) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((current) => Math.min(options.length - 1, current + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((current) => Math.max(0, current - 1));
          } else if (event.key === "Home") {
            event.preventDefault();
            setActive(0);
          } else if (event.key === "End") {
            event.preventDefault();
            setActive(options.length - 1);
          } else if (event.key === "Enter") {
            event.preventDefault();
            const option = options[active];
            if (option) commit(option);
          }
        }}
      >
        <span className="hud-menu__kicker">{kicker}</span>
        <span
          className="hud-menu__value"
          data-placeholder={selected ? "false" : "true"}
        >
          {face}
        </span>
        <span className="hud-menu__chevron" aria-hidden />
      </button>
      {panel}
    </div>
  );
}
