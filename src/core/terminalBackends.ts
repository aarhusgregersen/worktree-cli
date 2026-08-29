import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TerminalMode } from "../config/schema.js";
import { escapeShell } from "./shell.js";

export type TerminalKind =
  | "cmux"
  | "iterm2"
  | "apple_terminal"
  | "ghostty"
  | "warp"
  | "generic";

export interface DetectedTerminal {
  readonly kind: TerminalKind;
  readonly program: string;
}

export interface TerminalOpenRequest {
  readonly cwd: string;
  readonly command?: string;
  readonly env?: Record<string, string>;
  readonly mode?: TerminalMode;
  readonly focus?: boolean;
}

const getCmuxSocketPath = (): string =>
  process.env.CMUX_SOCKET_PATH ?? join(homedir(), ".cmux", "cmux.sock");

export const detectTerminal = (): DetectedTerminal => {
  if (existsSync(getCmuxSocketPath())) {
    return { kind: "cmux", program: "cmux" };
  }

  const program = process.env.TERM_PROGRAM ?? "";
  switch (program) {
    case "iTerm.app":
      return { kind: "iterm2", program };
    case "Apple_Terminal":
      return { kind: "apple_terminal", program };
    case "ghostty":
      return { kind: "ghostty", program };
    case "WarpTerminal":
      return { kind: "warp", program };
    default:
      return { kind: "generic", program: program || "unknown" };
  }
};

const writeLauncherScript = (request: TerminalOpenRequest): string => {
  const path = join("/tmp", `wtr-launch-${randomUUID()}.sh`);
  const lines: string[] = ["#!/bin/bash", ""];
  if (process.env.PATH)
    lines.push(`export PATH=${escapeShell(process.env.PATH)}`);
  for (const [key, value] of Object.entries(request.env ?? {})) {
    lines.push(`export ${key}=${escapeShell(value)}`);
  }
  lines.push(`cd ${escapeShell(request.cwd)}`);
  lines.push(`printf '\\033]7;file://%s%s\\033\\\\' "$(hostname)" "$(pwd)"`);
  if (request.command) lines.push(request.command);
  lines.push('exec "${SHELL:-/bin/bash}"');
  writeFileSync(path, `${lines.join("\n")}\n`, "utf-8");
  chmodSync(path, 0o755);
  return path;
};

const wrapPreserveFocus = (script: string, focus: boolean): string => {
  if (focus) return script;
  return `
    tell application "System Events"
      set previousApp to name of first application process whose frontmost is true
    end tell
    ${script}
    delay 0.05
    try
      tell application previousApp to activate
    end try
  `;
};

const escapeAppleScript = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const openInITerm2 = (
  scriptPath: string,
  mode: TerminalMode,
  focus: boolean,
): void => {
  const escaped = escapeAppleScript(scriptPath);
  const action =
    mode === "tab"
      ? `tell current window
           create tab with default profile command "${escaped}"
         end tell`
      : `create window with default profile command "${escaped}"`;
  const script = `tell application "iTerm2"
      ${action}
    end tell`;
  execSync(`osascript -e ${escapeShell(wrapPreserveFocus(script, focus))}`);
};

const openInAppleTerminal = (
  scriptPath: string,
  mode: TerminalMode,
  focus: boolean,
): void => {
  if (mode === "window") {
    execSync(
      `open ${focus ? "-a" : "-ga"} Terminal ${escapeShell(scriptPath)}`,
    );
    return;
  }
  const script = `tell application "Terminal"
      activate
      tell application "System Events" to tell process "Terminal" to keystroke "t" using command down
      delay 0.3
      do script "${escapeAppleScript(scriptPath)}" in front window
    end tell`;
  execSync(`osascript -e ${escapeShell(wrapPreserveFocus(script, focus))}`);
};

const openInCmux = (request: TerminalOpenRequest): void => {
  const socketPath = getCmuxSocketPath();
  const workspaceName = request.cwd.split("/").pop() ?? request.cwd;
  const exports = Object.entries(request.env ?? {})
    .map(([key, value]) => `export ${key}=${escapeShell(value)}`)
    .join(" && ");
  const prefix = exports ? `${exports} && ` : "";
  const command = request.command
    ? `${prefix}cd ${escapeShell(request.cwd)} && ${request.command}`
    : `${prefix}cd ${escapeShell(request.cwd)}`;
  const env = { ...process.env, CMUX_SOCKET_PATH: socketPath };

  try {
    execSync(`cmux new-workspace --name ${escapeShell(workspaceName)}`, {
      env,
      stdio: "pipe",
    });
    execSync(`cmux send ${escapeShell(command)}`, { env, stdio: "pipe" });
    execSync("cmux send-key enter", { env, stdio: "pipe" });
  } catch {
    console.log(`Could not open cmux workspace. Run manually:\n  ${command}`);
  }
};

const terminalAppName = (kind: TerminalKind): string | undefined => {
  const names: Partial<Record<TerminalKind, string>> = {
    ghostty: "Ghostty",
    warp: "Warp",
  };
  return names[kind];
};

const openGeneric = (
  terminal: DetectedTerminal,
  scriptPath: string,
  mode: TerminalMode,
  focus: boolean,
): void => {
  const appName = terminalAppName(terminal.kind);
  if (appName === "Ghostty") {
    try {
      execSync(
        `open ${focus ? "-a" : "-ga"} Ghostty --args --command=${escapeShell(scriptPath)}`,
      );
      return;
    } catch {
      // Fall through to the generic adapter.
    }
  }

  if (!appName) {
    execSync(
      `open ${focus ? "-a" : "-ga"} Terminal ${escapeShell(scriptPath)}`,
    );
    return;
  }

  try {
    let previousApp: string | undefined;
    if (!focus) {
      try {
        previousApp = execSync(
          `osascript -e ${escapeShell('tell application "System Events" to return name of first application process whose frontmost is true')}`,
          { encoding: "utf-8" },
        ).trim();
      } catch {
        // Focus restoration is best effort.
      }
    }

    if (mode === "tab") {
      const tabScript = `tell application "${escapeAppleScript(appName)}" to activate
        delay 0.3
        tell application "System Events" to tell process "${escapeAppleScript(appName)}" to keystroke "t" using command down`;
      execSync(`osascript -e ${escapeShell(tabScript)}`);
    } else {
      execSync(`open -a ${escapeShell(appName)}`);
    }

    const launchScript = `delay 0.5
      tell application "System Events"
        tell process "${escapeAppleScript(appName)}"
          keystroke "${escapeAppleScript(scriptPath)}"
          keystroke return
        end tell
      end tell`;
    execSync(`osascript -e ${escapeShell(launchScript)}`);

    if (previousApp) {
      try {
        execSync(
          `osascript -e ${escapeShell(`tell application "${escapeAppleScript(previousApp)}" to activate`)}`,
        );
      } catch {
        // Focus restoration is best effort.
      }
    }
  } catch {
    console.log(
      `Could not open terminal "${appName}". Run manually:\n  ${scriptPath}`,
    );
  }
};

export const openTerminalWithBackend = (request: TerminalOpenRequest): void => {
  const terminal = detectTerminal();
  if (terminal.kind === "cmux") {
    openInCmux(request);
    return;
  }

  const scriptPath = writeLauncherScript(request);
  const mode = request.mode ?? "window";
  const focus = request.focus ?? false;
  switch (terminal.kind) {
    case "iterm2":
      openInITerm2(scriptPath, mode, focus);
      return;
    case "apple_terminal":
      openInAppleTerminal(scriptPath, mode, focus);
      return;
    default:
      openGeneric(terminal, scriptPath, mode, focus);
  }
};
