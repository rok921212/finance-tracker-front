import React, { useId, useMemo, useRef, useState } from "react";

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
  /** Values to suggest, most relevant first */
  suggestions: string[];
  /** Most suggestions shown at once */
  max?: number;
}

const rank = (list: string[], typed: string, max: number) => {
  const q = typed.trim().toLowerCase();
  if (!q) return list.slice(0, max);
  const starts: string[] = [];
  const contains: string[] = [];
  for (const s of list) {
    const l = s.toLowerCase();
    if (l === q) continue; // already typed exactly
    if (l.startsWith(q)) starts.push(s);
    else if (l.includes(q)) contains.push(s);
  }
  return [...starts, ...contains].slice(0, max);
};

/**
 * Text input with a suggestion list (ARIA combobox): typed text matches anywhere, ignoring case,
 * names that start with it first. Arrow keys move, Enter / Tab pick, Escape closes.
 */
const SuggestInput: React.FC<Props> = ({ value, onChange, suggestions, max = 8, className = "", onBlur, onFocus, onKeyDown, ...rest }) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const items = useMemo(() => rank(suggestions, value, max), [suggestions, value, max]);
  const shown = open && items.length > 0;

  const pick = (s: string) => {
    onChange(s);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="relative">
      <input
        {...rest}
        ref={inputRef}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        className={className}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={(e) => {
          setOpen(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setOpen(false);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (shown) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % items.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
              return;
            }
            if ((e.key === "Enter" || e.key === "Tab") && active >= 0) {
              if (e.key === "Enter") e.preventDefault();
              pick(items[active]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              return;
            }
          } else if (e.key === "ArrowDown" && items.length) {
            setOpen(true);
          }
          onKeyDown?.(e);
        }}
      />
      {shown && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 shadow-xl py-1"
        >
          {items.map((s, i) => (
            <li
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown (not click) so the input's blur doesn't close the list first
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={`px-3 py-1.5 text-sm cursor-pointer truncate ${i === active ? "bg-red-600/30 text-white" : "text-gray-200"}`}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default SuggestInput;
