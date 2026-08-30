'use client';

import { useEffect, useRef, useState } from 'react';

type Suggestion = { displayName: string; address: string; city: string; state: string; postalCode: string };

export default function AddressAutocomplete({
  value, onChange, disabled, placeholder
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function handleChange(next: string) {
    onChange(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (next.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(next)}`, { signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data)) {
          setSuggestions(data);
          setOpen(data.length > 0);
        }
      } catch {
        // aborted or network hiccup — leave whatever suggestions we have
      }
    }, 400);
  }

  function pick(s: Suggestion) {
    const full = [s.address, s.city, [s.state, s.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    onChange(full || s.displayName);
    setOpen(false);
    setSuggestions([]);
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        className="input disabled:bg-slate-50 disabled:text-slate-500"
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(suggestions.length > 0)}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 top-full z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-line bg-panel shadow-2xl">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-slate-50"
              onClick={() => pick(s)}
              title={s.displayName}
            >
              {s.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
