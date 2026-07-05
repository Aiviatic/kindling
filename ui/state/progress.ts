import { Status, StepId, Section, SECTION_ORDER, STEP_SECTION } from '../../engine/contract';
import type { StepView } from './model';

/** User-facing heading for each install section on the Progress screen. */
export const SECTION_LABELS: Record<Section, string> = {
  [Section.System]: 'Getting your computer ready',
  [Section.Project]: 'Setting up your project',
};

export interface StepGroup {
  section: Section;
  label: string;
  steps: StepView[];
}

/**
 * Group the observed steps into their install sections, in section order, dropping sections that
 * have no steps yet (steps appear as they run). Order within a section is the engine's sequence,
 * which already matches the section order — so grouping never visually reorders a running step.
 */
export function groupBySection(steps: StepView[]): StepGroup[] {
  return SECTION_ORDER.map((section) => ({
    section,
    label: SECTION_LABELS[section],
    steps: steps.filter((s) => STEP_SECTION[s.id] === section),
  })).filter((g) => g.steps.length > 0);
}

export type Tone = 'wait' | 'busy' | 'success' | 'error';

export interface StatusView {
  /** A non-color glyph — meaning is carried by icon + word together, never color alone. */
  icon: string;
  word: string;
  tone: Tone;
}

// icon + WORD for each step status (a11y: status is never color-only). The tone is a styling
// hook ONLY; per DESIGN.md the accessible word tones are applied in CSS (busy→gold, wait→
// text-secondary, failed→text-primary) — the meaning lives in the glyph + word here.
export const STATUS_VIEW: Record<Status, StatusView> = {
  [Status.Queued]: { icon: '○', word: 'Queued', tone: 'wait' },
  [Status.Working]: { icon: '▶', word: 'Working', tone: 'busy' },
  [Status.Done]: { icon: '✓', word: 'Done', tone: 'success' },
  [Status.Skipped]: { icon: '✓', word: 'Already present', tone: 'success' },
  [Status.Failed]: { icon: '✗', word: 'Failed', tone: 'error' },
};

// Steps that are legitimately slow (a big download / a macOS system install). While one of
// these is Working we show indeterminate ACTIVITY rather than a stuck percentage, so the UI
// never looks frozen (FR — honest progress).
const SLOW_STEPS: ReadonlySet<StepId> = new Set([StepId.InstallMethod, StepId.ProvisionXcodeClt]);

export function isSlowStep(id: StepId): boolean {
  return SLOW_STEPS.has(id);
}

const isTerminal = (s: StepView): boolean =>
  s.status === Status.Done || s.status === Status.Skipped;

// The cross-platform minimum number of steps a run performs (node, git, scaffold, install,
// self-check; macOS adds xcode-clt). Used as a denominator FLOOR so the bar can't prematurely
// read 100% just because only one step has streamed in so far. [DEFERRED — the precise fix is
// the engine emitting its full step plan as `queued` up front, giving the UI an exact, stable
// denominator; see deferred-work. Until then this floor + the high-water clamp keep it honest.]
export const MIN_EXPECTED_STEPS = 5;

/**
 * Overall percent — advances ONLY on real completion (done/skipped); never synthesized from a
 * timer. Denominator is floored at MIN_EXPECTED_STEPS so an early single completion can't show
 * 100%. Combined with the caller's high-water clamp the bar is monotonic.
 */
export function overallPercent(steps: StepView[]): number {
  const completed = steps.filter(isTerminal).length;
  const denom = Math.max(steps.length, MIN_EXPECTED_STEPS);
  return Math.round((completed / denom) * 100);
}

/** The step currently working (if any) — the one whose row shows live activity. */
export function activeStep(steps: StepView[]): StepView | undefined {
  return steps.find((s) => s.status === Status.Working);
}

/** True when the active step is a known-slow one → render indeterminate activity, not a %. */
export function showsActivity(steps: StepView[]): boolean {
  const active = activeStep(steps);
  return active ? isSlowStep(active.id) : false;
}

/** Accessible description for the progress bar (aria-valuetext) — words, not just a number. */
export function valueText(steps: StepView[]): string {
  if (steps.length === 0) return 'Getting started…'; // pre-first-event; `[].every()` is vacuously true
  const active = activeStep(steps);
  if (active) return `${overallPercent(steps)}% - ${active.message}`;
  if (steps.some((s) => s.status === Status.Failed)) return 'Stopped, see the details below.';
  if (steps.every(isTerminal)) return 'Complete.';
  return `${overallPercent(steps)}%`;
}
