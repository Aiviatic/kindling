import type { Pins } from './contract';

// Frozen pin manifest — the single source of truth for version pins, consumed by the
// bootstrap copy, install orchestration, the Welcome screen, and the Validation Page.
// Frozen for the duration of a cohort cycle so home == workshop (NFR-3).
//
// `node` is the version Kindling provisions for the user (engine runtime floor is 20+).
// `bmad` MUST be pinned to the cohort's tested bmad-method version before a real install
// is shipped (see Story 1.5 / Epic 2). `kindling` is this package's own version.
export const pins: Readonly<Pins> = Object.freeze({
  node: '24.16.0',
  bmad: '6.9.0', // frozen for the Cohort #1 cycle (matches this repo's BMad install; tools + install flags verified vs the real 6.9.0 CLI 2026-07-02); bump between cohorts
  kindling: '0.2.1',
});
