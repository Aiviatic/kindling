// UI-side gate + copy for the Epic-7 "Update to latest BMad" opt-in (Story 7.2 / FR26/FR27).
//
// Plain-module house style (matches ui/config/agent-cli.ts / defaults.ts / ide-catalog.ts) —
// trivially unit-testable, no Vite `import.meta.env` plumbing (there is NO `VITE_`-env precedent
// in this repo today). FLAGGED FOR REVIEW (Dev Notes → cohort-gate): a plain exported constant vs
// a Vite build-flag. Recommend the constant; the post-cohort flip is a one-line edit + rebuild.

/**
 * Build-time cohort gate. Default **OFF** for the cohort window so a normal-flow student never
 * lands on update-to-latest, and the inspect probe never fires (NFR3 reproducibility, defense in
 * depth alongside the Customize-disclosure placement).
 *
 * Flip to `true` in the post-cohort release (after ~the July 11 go-live) to expose the opt-in
 * update-to-latest affordance (Epic 7 / FR27).
 */
export const ENABLE_BMAD_UPDATE = false;

/**
 * Single source of truth for the affordance label + the LOUD reproducibility warning (AC-2) and
 * the detected-state copy (AC-4). Kitchen-table tone, but the warning is unmistakably a departure
 * from the safe frozen default — not a quiet footnote.
 */
export const BMAD_UPDATE_COPY = {
  /** The opt-in checkbox label (AC-1/AC-2). */
  optInLabel: 'Update this existing project to the latest BMad',
  /** The loud reproducibility warning shown adjacent to the control whenever it renders (AC-2). */
  warning:
    'This moves you off the frozen workshop version your cohort was tested on. Only do this if you know you want the newest BMad.',
  /** Detected-state lines (AC-4). `detected` takes the real current version. */
  checking: 'Checking this folder…',
  detected: (version: string): string => `Detected: BMad ${version} installed in this folder`,
  detectedUnknownVersion: 'Detected an existing project here (version unknown)',
  none: 'No existing Kindling project here',
  error: "Couldn't check this folder",
  /** The `X.Y.Z → latest` hint shown next to the opt-in (AC-4). */
  targetHint: (current: string): string => `${current} → latest`,
} as const;
