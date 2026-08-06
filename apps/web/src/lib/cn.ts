import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes, letting later ones win over earlier conflicts.
 * Without `twMerge`, a component that hardcodes `px-4` and a caller that
 * passes `px-6` would emit both and the outcome would depend on stylesheet
 * order rather than on intent.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
