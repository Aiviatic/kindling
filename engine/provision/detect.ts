import { randomUUID } from 'node:crypto';
import { exec as defaultExec, type ExecResult } from '../exec';
import { probeVersion } from '../probe';
import type { EngineEmitter } from '../emitter';
import { Phase, StepId, Status, type Level } from '../contract';
import { provisionMessages } from '../messages';
import { parseMajor, NODE_FLOOR_MAJOR } from '../validation-summary';

export interface ToolState {
  present: boolean;
  version: string | null;
}
export interface NodeState extends ToolState {
  satisfiesFloor: boolean;
}
export interface DependencyState {
  node: NodeState;
  git: ToolState;
}

export interface DetectOptions {
  exec?: (cmd: string, args: string[]) => Promise<ExecResult>;
  node?: string;
  git?: string;
  emitter?: EngineEmitter;
  now?: () => string;
}

// Detects Git + Node (and whether Node meets the floor) so provisioners can skip vs install.
// When an emitter is passed, reports each tool's state: reuse → Skipped, needs-install → Queued.
export async function detectDependencies(opts: DetectOptions = {}): Promise<DependencyState> {
  const exec = opts.exec ?? defaultExec;
  const now = opts.now ?? (() => new Date().toISOString());

  const nodeVersion = await probeVersion(exec, opts.node ?? 'node');
  const nodeMajor = parseMajor(nodeVersion);
  const node: NodeState = {
    present: nodeVersion !== null,
    version: nodeVersion,
    satisfiesFloor: nodeMajor !== null && nodeMajor >= NODE_FLOOR_MAJOR,
  };

  const gitVersion = await probeVersion(exec, opts.git ?? 'git');
  const git: ToolState = { present: gitVersion !== null, version: gitVersion };

  const emitter = opts.emitter;
  if (emitter) {
    const emit = (step: StepId, status: Status, humanMessage: string, level: Level = 'info'): void => {
      emitter.emit({
        id: randomUUID(),
        phase: Phase.Provision,
        step,
        status,
        humanMessage,
        level,
        timestamp: now(),
      });
    };
    // Node reuse requires meeting the floor; an old Node must be upgraded.
    if (node.present && node.satisfiesFloor) {
      emit(StepId.ProvisionNode, Status.Skipped, provisionMessages.nodePresent);
    } else {
      emit(StepId.ProvisionNode, Status.Queued, provisionMessages.nodeQueued);
    }
    if (git.present) {
      emit(StepId.ProvisionGit, Status.Skipped, provisionMessages.gitPresent);
    } else {
      emit(StepId.ProvisionGit, Status.Queued, provisionMessages.gitQueued);
    }
  }

  return { node, git };
}
