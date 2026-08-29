import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { escapeShell } from "./shell.js";
import {
  type TerminalOpenRequest,
  detectTerminal,
  openTerminalWithBackend,
} from "./terminalBackends.js";

export type {
  DetectedTerminal,
  TerminalKind,
  TerminalOpenRequest,
} from "./terminalBackends.js";
export { detectTerminal };

export const writePlanToTempFile = (plan: string): string => {
  const path = join("/tmp", `wtr-plan-${randomUUID()}.md`);
  writeFileSync(path, plan, "utf-8");
  return path;
};

export const buildWorktreeEnv = (options: {
  readonly path: string;
  readonly branch: string | undefined;
}): Record<string, string> => ({
  WT_ACTIVE: "1",
  WT_NAME: options.path.split("/").pop() ?? options.path,
  WT_BRANCH: options.branch ?? "",
  WT_PATH: options.path,
});

export const buildClaudeCommand = (options?: {
  readonly planPath?: string;
  readonly autoMode?: boolean;
  readonly model?: string;
}): string => {
  const autoFlag = options?.autoMode === true ? " --permission-mode auto" : "";
  const modelFlag = options?.model
    ? ` --model ${escapeShell(options.model)}`
    : "";
  const flags = `${autoFlag}${modelFlag}`;
  return options?.planPath
    ? `claude${flags} "$(cat ${escapeShell(options.planPath)})"`
    : `claude${flags}`;
};

export const openTerminalWindow = (request: TerminalOpenRequest): void => {
  openTerminalWithBackend(request);
};
