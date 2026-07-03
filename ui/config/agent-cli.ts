// UI-side mirror of the eligible agent-CLI ids (Story 6.2). The browser bundle can't cleanly import
// engine/orchestrate/agent-cli.ts's `AGENT_CLI_TABLE` value (it drags node-only deps: exec/probe),
// so the id + friendly-label subset lives here.
//
// KEEP IN SYNC with engine/orchestrate/agent-cli.ts `AGENT_CLI_TABLE`. A wrong/extra id here is
// harmless (the engine scope-guard ignores anything not in the table), but a MISSING id would
// silently drop an opt-in checkbox — so mirror every table id.
export const AGENT_CLI_IDS = ['claude-code', 'codex'] as const;
export type AgentCliId = (typeof AGENT_CLI_IDS)[number];

export const AGENT_CLI_LABELS: Record<AgentCliId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
};

/** True when an IDE id is an eligible agent-CLI id (the opt-in scope guard, mirroring the engine). */
export function isAgentCliId(id: string): id is AgentCliId {
  return (AGENT_CLI_IDS as readonly string[]).includes(id);
}
