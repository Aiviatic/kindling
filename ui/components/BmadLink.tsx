import type { ReactNode } from 'react';
import { BMAD_URL } from '../config/links';

// "BMad" as a link to the BMAD-METHOD repo, opening in a new tab (with the a11y new-tab hint).
// Centralized so every BMad mention points at the same place and stays consistent.
export function BmadLink({ children }: { children?: ReactNode }) {
  return (
    <a href={BMAD_URL} target="_blank" rel="noreferrer">
      {children ?? 'BMad'}
      <span className="sr-live"> (opens in a new tab)</span>
    </a>
  );
}
