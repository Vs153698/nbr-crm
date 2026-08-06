import { useEffect, useState } from 'react';

/**
 * Delay a rapidly-changing value.
 *
 * Used by global search (150 ms) and by the live duplicate check on the Add
 * Applicant form — without it, every keystroke would be a database query.
 */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
