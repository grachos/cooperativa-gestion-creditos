import { useEffect, useId, useRef, useState } from "react";

export interface ComboOption {
  id: number;
  label: string;
  /** Texto secundario (p. ej. el documento), también se muestra en la lista. */
  detail?: string;
}

interface SearchComboboxProps {
  /** Id seleccionado ("" = ninguno). */
  value: string;
  onChange: (id: string) => void;
  /** Busca en el servidor: se llama al abrir y mientras se escribe (con espera de 250 ms). */
  search: (query: string) => Promise<ComboOption[]>;
  placeholder: string;
  /** Ids que no se ofrecen (p. ej. el titular en la lista de codeudores). */
  excludeIds?: string[];
  ariaLabel?: string;
}

const DEBOUNCE_MS = 250;

/**
 * Selector con búsqueda en el mismo componente: se escribe para filtrar (nombre, apellido o cédula, varias
 * palabras) y se elige con el mouse o con las flechas + Enter. Busca en el servidor, así que sigue sirviendo
 * cuando hay miles de registros (un `<select>` solo podía cargar los primeros 100).
 */
export function SearchCombobox({ value, onChange, search, placeholder, excludeIds = [], ariaLabel }: SearchComboboxProps) {
  const listId = useId();
  const [text, setText] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ComboOption[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [active, setActive] = useState(0);
  const requestSeq = useRef(0);
  const searchRef = useRef(search);
  searchRef.current = search;

  // Si el formulario borra la selección desde fuera, se limpia el texto.
  useEffect(() => {
    if (value === "") setSelectedLabel("");
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const seq = ++requestSeq.current;
    setStatus("loading");
    const timer = setTimeout(
      () => {
        searchRef.current(text.trim()).then(
          (found) => {
            if (seq !== requestSeq.current) return; // llegó una respuesta vieja
            setOptions(found);
            setActive(0);
            setStatus("idle");
          },
          () => {
            if (seq === requestSeq.current) setStatus("error");
          }
        );
      },
      text ? DEBOUNCE_MS : 0
    );
    return () => clearTimeout(timer);
  }, [open, text]);

  const visible = options.filter((o) => !excludeIds.includes(String(o.id)));

  function choose(option: ComboOption) {
    onChange(String(option.id));
    setSelectedLabel(option.label);
    setText("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(visible.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault(); // no enviar el formulario al elegir
      if (visible[active]) choose(visible[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel ?? placeholder}
        autoComplete="off"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        placeholder={value && selectedLabel ? selectedLabel : placeholder}
        value={open || !selectedLabel ? text : selectedLabel}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (value) {
            onChange(""); // al escribir se descarta la selección anterior
            setSelectedLabel("");
          }
        }}
        onBlur={() => {
          setOpen(false);
          setText("");
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {status === "loading" && visible.length === 0 && <li className="px-3 py-2 text-slate-400">Buscando…</li>}
          {status === "error" && <li className="px-3 py-2 text-red-600">No se pudo buscar. Intente de nuevo.</li>}
          {status === "idle" && visible.length === 0 && <li className="px-3 py-2 text-slate-400">Sin resultados</li>}
          {visible.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={String(o.id) === value}
              // mouseDown (no click): el campo no pierde el foco antes de elegir
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-brand-50 text-slate-900" : "text-slate-700"}`}
            >
              {o.label}
              {o.detail && <span className="ml-2 text-xs text-slate-400">{o.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
