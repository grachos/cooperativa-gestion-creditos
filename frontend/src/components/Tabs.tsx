import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem<K extends string> {
  key: K;
  label: string;
}

interface TabBarProps<K extends string> {
  tabs: readonly TabItem<K>[];
  active: K;
  onChange: (key: K) => void;
  className?: string;
}

/** Barra de pestañas con un indicador que se desliza hasta la pestaña activa. */
export function TabBar<K extends string>({ tabs, active, onChange, className = "" }: TabBarProps<K>) {
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const btn = list.querySelector<HTMLButtonElement>(`[data-tab-key="${active}"]`);
      if (btn) setIndicator({ left: btn.offsetLeft, width: btn.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [active, tabs]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.key === active);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    if (!next) return;
    onChange(next.key);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-tab-key="${next.key}"]`)?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      onKeyDown={onKeyDown}
      className={`relative flex gap-1 overflow-x-auto border-b border-slate-200 [scrollbar-width:none] ${className}`}
    >
      {tabs.map((t) => {
        const selected = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            data-tab-key={t.key}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.key)}
            className={`shrink-0 whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors duration-200 ${
              selected ? "text-brand-700" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        );
      })}
      {indicator && (
        <span
          aria-hidden="true"
          className="tab-indicator pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-brand-600"
          style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }}
        />
      )}
    </div>
  );
}

interface CrossfadePanelsProps<K extends string> {
  activeKey: K;
  children: (key: K) => ReactNode;
}

const FADE_MS = 260;

/**
 * Al cambiar de pestaña, el panel anterior se desvanece mientras el nuevo
 * aparece. Ambos ocupan la misma celda de la grilla durante la transición
 * y el saliente se desmonta al terminar.
 */
export function CrossfadePanels<K extends string>({ activeKey, children }: CrossfadePanelsProps<K>) {
  const [shown, setShown] = useState(activeKey);
  const [leaving, setLeaving] = useState<K | null>(null);

  if (activeKey !== shown) {
    setLeaving(shown);
    setShown(activeKey);
  }

  useLayoutEffect(() => {
    if (leaving === null) return;
    const timer = setTimeout(() => setLeaving(null), FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving, shown]);

  const keys = leaving !== null && leaving !== shown ? [leaving, shown] : [shown];

  return (
    <div className="grid">
      {keys.map((k) => {
        const isLeaving = k === leaving && k !== shown;
        return (
          <div
            key={k}
            role="tabpanel"
            aria-hidden={isLeaving || undefined}
            inert={isLeaving || undefined}
            className={`min-w-0 [grid-area:1/1] ${isLeaving ? "tab-fade-out pointer-events-none" : leaving !== null ? "tab-fade-in" : ""}`}
          >
            {children(k)}
          </div>
        );
      })}
    </div>
  );
}
