import type { TerminalConfig } from "../config/schema.js";
import { resolvePlanText } from "./plan.js";
import {
  buildClaudeCommand,
  buildWorktreeEnv,
  openTerminalWindow,
  writePlanToTempFile,
} from "./terminal.js";

export interface LaunchSpec {
  readonly cwd: string;
  readonly branch: string | undefined;
  readonly env: Readonly<Record<string, string>>;
  readonly command: string | undefined;
  readonly planPath: string | undefined;
  readonly terminal: TerminalConfig;
  readonly handoff: boolean;
}

export interface LaunchRequest {
  readonly cwd: string;
  readonly branch: string | undefined;
  readonly terminal: TerminalConfig;
  readonly startClaude: boolean;
  readonly plan?: string;
  readonly planFile?: string;
  readonly model?: string;
}

export interface LaunchDependencies {
  readonly resolvePlanText: typeof resolvePlanText;
  readonly writePlanToTempFile: typeof writePlanToTempFile;
  readonly buildClaudeCommand: typeof buildClaudeCommand;
  readonly buildWorktreeEnv: typeof buildWorktreeEnv;
  readonly openTerminalWindow: typeof openTerminalWindow;
}

export const defaultLaunchDependencies: LaunchDependencies = {
  resolvePlanText,
  writePlanToTempFile,
  buildClaudeCommand,
  buildWorktreeEnv,
  openTerminalWindow,
};

export const prepareLaunchSpec = async (
  request: LaunchRequest,
  dependencies: LaunchDependencies = defaultLaunchDependencies,
): Promise<LaunchSpec> => {
  const hasPlan = Boolean(request.plan || request.planFile);
  const planText = hasPlan
    ? await dependencies.resolvePlanText({
        plan: request.plan,
        planFile: request.planFile,
      })
    : undefined;
  const planPath =
    planText !== undefined
      ? dependencies.writePlanToTempFile(planText)
      : undefined;
  const command =
    request.startClaude || planPath
      ? dependencies.buildClaudeCommand({
          planPath,
          autoMode: request.terminal.autoMode,
          model: request.model,
        })
      : undefined;

  return {
    cwd: request.cwd,
    branch: request.branch,
    env: dependencies.buildWorktreeEnv({
      path: request.cwd,
      branch: request.branch,
    }),
    command,
    planPath,
    terminal: request.terminal,
    handoff: command !== undefined,
  };
};

export const executeLaunchSpec = (
  spec: LaunchSpec,
  dependencies: LaunchDependencies = defaultLaunchDependencies,
): void => {
  dependencies.openTerminalWindow({
    cwd: spec.cwd,
    command: spec.command,
    env: { ...spec.env },
    mode: spec.terminal.mode,
    focus: spec.terminal.focus,
  });
};

export const launchSpecJson = (spec: LaunchSpec) => ({
  path: spec.cwd,
  branch: spec.branch,
  command: spec.command ?? null,
  env: spec.env,
  ...(spec.planPath ? { planPath: spec.planPath } : {}),
  ...(spec.handoff ? { handoff: true } : {}),
});
