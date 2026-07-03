import { describe, it, expect } from 'vitest';
import { Status, StepId } from '../../engine/contract';
import type { StepView } from './model';
import {
  STATUS_VIEW,
  overallPercent,
  isSlowStep,
  showsActivity,
  valueText,
  activeStep,
} from './progress';

const step = (id: StepId, status: Status, message: string = id): StepView => ({
  id,
  status,
  message,
});

describe('STATUS_VIEW', () => {
  it('gives every status a non-empty icon AND word (never color-only)', () => {
    for (const status of Object.values(Status)) {
      const v = STATUS_VIEW[status];
      expect(v.icon.length, status).toBeGreaterThan(0);
      expect(v.word.length, status).toBeGreaterThan(0);
    }
  });

  it('treats skipped as a success-toned "Already present"', () => {
    expect(STATUS_VIEW[Status.Skipped].word).toBe('Already present');
    expect(STATUS_VIEW[Status.Skipped].tone).toBe('success');
  });
});

describe('overallPercent (advances only on real completion, denominator floored)', () => {
  it('is 0 for no steps', () => {
    expect(overallPercent([])).toBe(0);
  });

  it('counts done + skipped over a floored denominator (no premature 100)', () => {
    const steps = [
      step(StepId.ProvisionNode, Status.Done),
      step(StepId.ProvisionGit, Status.Skipped),
      step(StepId.InstallBmad, Status.Working),
    ];
    expect(overallPercent(steps)).toBe(40); // 2 of max(3, 5)
  });

  it('does not read 100% after just one early completion', () => {
    expect(overallPercent([step(StepId.ProvisionNode, Status.Done)])).toBe(20); // 1 of 5, not 100
  });

  it('reaches 100 when a full run of steps is terminal', () => {
    expect(
      overallPercent([
        step(StepId.ProvisionNode, Status.Done),
        step(StepId.ProvisionGit, Status.Done),
        step(StepId.ScaffoldGitInit, Status.Done),
        step(StepId.InstallBmad, Status.Done),
        step(StepId.FinalizeSelfCheck, Status.Done),
      ]),
    ).toBe(100);
  });

  it('a working step does not advance the bar', () => {
    expect(overallPercent([step(StepId.InstallBmad, Status.Working)])).toBe(0);
  });
});

describe('slow-step activity', () => {
  it('flags the known-slow steps', () => {
    expect(isSlowStep(StepId.InstallBmad)).toBe(true);
    expect(isSlowStep(StepId.ProvisionXcodeClt)).toBe(true);
    expect(isSlowStep(StepId.ProvisionNode)).toBe(false);
  });

  it('shows indeterminate activity only while a slow step is working', () => {
    expect(showsActivity([step(StepId.InstallBmad, Status.Working)])).toBe(true);
    expect(showsActivity([step(StepId.ProvisionNode, Status.Working)])).toBe(false);
    expect(showsActivity([step(StepId.InstallBmad, Status.Done)])).toBe(false);
  });

  it('activeStep is the working one, if any', () => {
    const working = step(StepId.InstallBmad, Status.Working);
    expect(activeStep([step(StepId.ProvisionNode, Status.Done), working])).toBe(working);
    expect(activeStep([step(StepId.ProvisionNode, Status.Done)])).toBeUndefined();
  });
});

describe('valueText (accessible, word-bearing)', () => {
  it('describes the working step with percent', () => {
    expect(valueText([step(StepId.InstallBmad, Status.Working, 'Installing BMad…')])).toBe(
      '0% — Installing BMad…',
    );
  });

  it('says Complete when all terminal, Stopped on failure', () => {
    expect(valueText([step(StepId.FinalizeSelfCheck, Status.Done)])).toBe('Complete.');
    expect(valueText([step(StepId.InstallBmad, Status.Failed)])).toMatch(/Stopped/);
  });
});
