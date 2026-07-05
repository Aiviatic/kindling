// Engine barrel — the public surface of the headless Core Engine.
// (tsup builds this entry to dist/.) Real orchestration logic lands in Stories 1.4–1.7.
export * from './contract';
export { pins } from './pins';
export { stepMessages, errorMessages, recoveryGuidance } from './messages';
export { EngineEmitter } from './emitter';
export type { EventListener } from './emitter';
export { exec } from './exec';
export type { ExecResult } from './exec';
export { scaffold } from './orchestrate/scaffold';
export type { ScaffoldOutcome, ScaffoldOptions } from './orchestrate/scaffold';
export { composeInstallArgs } from './orchestrate/flags';
export { composeLaunchCommand, npxCliPath } from './orchestrate/launch';
export type { LaunchRuntime, LaunchCommand } from './orchestrate/launch';
export { runBmadInstall, defaultBmadInstalled } from './orchestrate/bmad-install';
export type { BmadInstallResult, BmadInstallOptions } from './orchestrate/bmad-install';
export type { MethodProvider, MethodContext, MethodInstallResult } from './method/provider';
export { getMethod, DEFAULT_METHOD } from './method/registry';
export { bmadProvider } from './method/bmad-provider';
export { noneProvider } from './method/none-provider';
export { installAgentCli, eligibleAgentClis, AGENT_CLI_TABLE } from './orchestrate/agent-cli';
export type { AgentCliResult, AgentCliOptions, AgentCliDescriptor } from './orchestrate/agent-cli';
export { runSelfCheck } from './self-check';
export type { SelfCheckOptions } from './self-check';
export { readInstalledBmadVersion } from './bmad-manifest';
export {
  buildValidationSummary,
  parseMajor,
  cliLoginGuidance,
  cliMissing,
  bmadVersionLabel,
  SCHEMA_VERSION,
  NODE_FLOOR_MAJOR,
} from './validation-summary';
export type { ValidationSummary, ValidationFacts, CliPresence } from './validation-summary';
export { Engine } from './engine';
export type { EngineDeps, EngineRunResult } from './engine';
export { writeFailureLog, defaultLogDir } from './log';
export type { FailureLogEntry } from './log';
export { detectDependencies } from './provision/detect';
export type { DependencyState, ToolState, NodeState } from './provision/detect';
export { provisionNodeWindows, nodeDistUrl, nodeExePath } from './provision/node-windows';
export type { ProvisionNodeWindowsOptions, ProvisionResult, NodeArch } from './provision/node-windows';
export { provisionNodeUnix, nvmNodePath, NVM_VERSION } from './provision/node-unix';
export type { ProvisionNodeUnixOptions } from './provision/node-unix';
export { provisionGitUnix } from './provision/git-unix';
export type { ProvisionGitUnixOptions, ProvisionGitResult } from './provision/git-unix';
