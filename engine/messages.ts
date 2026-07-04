import { StepId, ErrorCode } from './contract';

// Human-facing, kitchen-table copy. The engine resolves these into events so frontends
// never compose text (architecture: Communication Patterns). Keyed by StepId; error copy
// keyed by a stable error code. Keys reference the StepId enum (never raw strings) so this
// catalog stays in sync with the contract.
export const stepMessages: Record<StepId, string> = {
  [StepId.ProvisionNode]: 'Setting up Node - the engine your project runs on.',
  [StepId.ProvisionGit]: 'Setting up Git - it keeps the history of your project safe.',
  [StepId.ProvisionXcodeClt]:
    'macOS is installing some developer tools. A system dialog popped up: click Install. ' +
    'This is completely normal and usually takes about 5 minutes. You can grab a coffee.',
  [StepId.ScaffoldGitInit]: 'Creating your project folder and starting its history.',
  [StepId.InstallBmad]:
    'Installing BMad - the toolkit that powers your project. This is a sizeable download, ' +
    'so it can take a couple of minutes. Nothing is stuck; hang tight.',
  [StepId.InstallAgentCli]:
    'Installing your AI coding assistant so it’s ready to run right after setup.',
  [StepId.FinalizeSelfCheck]: 'Double-checking everything is in place.',
};

// Optional agent-CLI install copy (Story 6.1), one line per per-CLI outcome. `name` is the
// friendly agent name (e.g. "Claude Code"); `manualInstall(pkg)` is the exact fallback command
// shown when an install fails — the install is machine-global, so a manual run fixes it for good.
export const agentCliMessages = {
  working: (name: string): string => `Installing ${name} so you can start right away.`,
  done: (name: string): string => `${name} is installed and ready to run.`,
  skipped: (name: string): string => `${name} is already installed, reusing it.`,
  failed: (name: string): string =>
    `${name} didn’t finish installing - your project is still set up and ready. ` +
    `You can press Retry, or install it yourself later.`,
  manualInstall: (pkg: string): string => `To install it yourself later, run: npm install -g ${pkg}`,
} as const;

// Scaffold-step outcome copy (one message per terminal outcome — the step has several).
export const scaffoldMessages = {
  done: 'Your project folder is ready.',
  skipped: 'Project already set up, nothing to do.',
  blocked:
    'This folder already has files in it. Kindling won’t change anything without your OK, ' +
    'pick an empty folder, or confirm before continuing.',
  failed: 'Setting up your project folder ran into a problem. Check the details, then press Retry.',
} as const;

// Provisioning detection copy (per tool, by detected state).
export const provisionMessages = {
  nodePresent: 'Node is already installed, reusing it.',
  nodeQueued: 'Node needs setting up - the engine your project runs on.',
  gitPresent: 'Git is already installed, reusing it.',
  gitQueued: 'Git needs setting up - it keeps the history of your project.',
  gitInstalled: 'Git is set up.',
  xcodeWaiting:
    'Still installing developer tools… the macOS dialog is doing its thing. This can take a few minutes, hang tight, nothing is stuck.',
  xcodeDone: 'Developer tools are ready - Git is set up.',
  xcodeTimeout:
    'The developer-tools install is taking longer than expected. If the macOS dialog is still open, let it finish, then press Retry.',
  xcodeInstallFailed:
    'We couldn’t start the developer-tools install. Make sure you’re connected, then press Retry.',
  gitInstallFailed:
    'Setting up Git ran into a problem, it may need permission to install. Check the details, then press Retry.',
} as const;

// Post-install self-check step copy.
export const selfCheckMessages = {
  done: 'Everything checks out, you’re ready.',
  failed: 'Some checks didn’t pass, see the readiness details.',
};

// BMad install step copy.
export const installMessages = {
  notPinned: 'BMad isn’t pinned to a version yet, set the cohort version before installing.',
  done: (version: string): string => `BMad ${version} installed.`,
};

// Error copy: always plain-language, never blames the user, always implies a next step.
// Keyed by the ErrorCode enum (not raw strings) so it stays in sync with the contract.
export const errorMessages: Record<ErrorCode, string> = {
  [ErrorCode.ExecFailed]: 'Something needs a quick fix: a step did not finish. Check the next step below, then press Retry.',
  [ErrorCode.NetworkLost]: 'We lost the connection. Reconnect to the internet, then press Retry.',
  [ErrorCode.BmadInstallFailed]: 'BMad didn’t finish installing. The details are below, press Retry.',
  [ErrorCode.AgentCliInstallFailed]:
    'Your AI coding assistant didn’t finish installing - your project is still ready. Press Retry, or install it yourself later.',
  [ErrorCode.ExecPolicyBlocked]: 'Windows blocked the script because it’s unsigned, that’s expected, safe, and reversible.',
  [ErrorCode.SmartScreenBlocked]: 'Windows SmartScreen (or your antivirus) paused the script, that’s expected, safe, and reversible.',
  [ErrorCode.ProjectConflict]: 'That folder already has files in it that Kindling didn’t create.',
};

/**
 * Structured recovery guidance for the in-UI error screen (Story 3.6). The UI RENDERS this; it
 * never composes its own copy. Each entry names the cause and a concrete next step; some carry a
 * one-line fix command (shown with a copy button) or route to a non-destructive choice.
 *  - `recovery: 'retry'`  → show a Retry button (re-run the failed step).
 *  - `recovery: 'choose-folder'` → no destructive default; let the user pick another folder (FR-9).
 */
export interface RecoveryGuidance {
  /** Short reassuring framing headline. */
  title: string;
  /** The cause + the concrete next step, plain language. */
  detail: string;
  /** Optional one-line command the user runs, then retries (e.g. the Windows policy fix). */
  fixCommand?: string;
  recovery: 'retry' | 'choose-folder';
}

export const recoveryGuidance: Record<ErrorCode, RecoveryGuidance> = {
  [ErrorCode.ExecFailed]: {
    title: 'Something needs a quick fix.',
    detail: 'A step didn’t finish. This usually clears up on a second try, press Retry.',
    recovery: 'retry',
  },
  [ErrorCode.NetworkLost]: {
    title: 'We lost the connection.',
    detail:
      'A download was interrupted. Reconnect to the internet, then press Retry, Kindling resumes where it left off.',
    recovery: 'retry',
  },
  [ErrorCode.BmadInstallFailed]: {
    title: 'BMad didn’t install.',
    detail:
      'The install step didn’t finish. This is usually temporary, press Retry. The step details below show what happened.',
    recovery: 'retry',
  },
  [ErrorCode.AgentCliInstallFailed]: {
    // No `fixCommand` here: the exact package differs per CLI (claude-code vs codex), so the
    // concrete, copy-pasteable `npm install -g <package>` line ships in the failed step's own
    // message (agentCliMessages.manualInstall) rather than in this static, error-code-keyed entry.
    title: 'Your AI assistant didn’t install.',
    detail:
      'Your project is set up and ready either way, this step is optional. Press Retry to try again, or install it yourself later using the command shown in the step details below.',
    recovery: 'retry',
  },
  [ErrorCode.ExecPolicyBlocked]: {
    title: 'Something needs a quick fix.',
    detail:
      'Windows blocked the script because it’s unsigned, that’s expected, and it’s safe and reversible. Run this one line in PowerShell, then come back and press Retry:',
    fixCommand: 'Set-ExecutionPolicy -Scope Process Bypass',
    recovery: 'retry',
  },
  [ErrorCode.SmartScreenBlocked]: {
    title: 'Windows asked you to confirm.',
    detail:
      'SmartScreen or your antivirus paused the script, this is expected and safe. Choose “More info”, then “Run anyway”, and press Retry. Nothing was changed on your computer.',
    recovery: 'retry',
  },
  [ErrorCode.ProjectConflict]: {
    title: 'That folder isn’t empty.',
    detail:
      'It already contains files Kindling didn’t create, so we won’t touch them. Pick a different (empty or new) folder and we’ll set up there.',
    recovery: 'choose-folder',
  },
};
