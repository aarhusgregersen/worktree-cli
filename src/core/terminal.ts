import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TerminalMode } from "../config/schema.js";

export type TerminalApp =
  | "cmux"
  | "iterm2"
  | "apple_terminal"
  | "ghostty"
  | "warp"
  | string;

const getCmuxSocketPath = (): string => {
  return process.env["CMUX_SOCKET_PATH"] ?? join(homedir(), ".cmux", "cmux.sock");
};

const isCmuxAvailable = (): boolean => {
  return existsSync(getCmuxSocketPath());
};

export const detectTerminal = (): TerminalApp => {
  // cmux takes priority — if its socket is available, use it
  if (isCmuxAvailable()) {
    return "cmux";
  }

  const termProgram = process.env["TERM_PROGRAM"] ?? "";

  switch (termProgram) {
    case "iTerm.app":
      return "iterm2";
    case "Apple_Terminal":
      return "apple_terminal";
    case "ghostty":
      return "ghostty";
    case "WarpTerminal":
      return "warp";
    default:
      return termProgram || "unknown";
  }
};

export const writePlanToTempFile = (plan: string): string => {
  const filename = `wtr-plan-${randomUUID()}.md`;
  const filepath = join("/tmp", filename);
  writeFileSync(filepath, plan, "utf-8");
  return filepath;
};

export const buildWorktreeEnv = (opts: {
  path: string;
  branch: string | undefined;
}): Record<string, string> => ({
  WT_ACTIVE: "1",
  WT_NAME: opts.path.split("/").pop() ?? opts.path,
  WT_BRANCH: opts.branch ?? "",
  WT_PATH: opts.path,
});

const escapeShell = (s: string): string => {
  return `'${s.replace(/'/g, "'\\''")}'`;
};

export const buildClaudeCommand = (planPath?: string): string => {
  if (planPath) {
    return `claude --enable-auto-mode "$(cat ${escapeShell(planPath)})"`;
  }
  return "claude --enable-auto-mode";
};

// Shell command that emits an OSC 7 escape sequence reporting the current
// working directory.  Terminals (iTerm2, Apple Terminal, Ghostty, …) use
// this to track the cwd so that "new tab in same directory" works even when
// a long-running process like `claude` prevents the shell from updating it.
const OSC7_PRINTF = `printf '\\033]7;file://%s%s\\033\\\\' "$(hostname)" "$(pwd)"`;

export const openTerminalWindow = (opts: {
  readonly cwd: string;
  readonly command?: string;
  readonly env?: Record<string, string>;
  readonly mode?: TerminalMode;
}): void => {
  const terminal = detectTerminal();
  const mode = opts.mode ?? "window";
  const envExports = opts.env
    ? Object.entries(opts.env)
        .map(([k, v]) => `export ${k}=${escapeShell(v)}`)
        .join(" && ")
    : "";
  const prefix = envExports ? `${envExports} && ` : "";
  const fullCommand = opts.command
    ? `${prefix}cd ${escapeShell(opts.cwd)} && ${OSC7_PRINTF} && ${opts.command}`
    : `${prefix}cd ${escapeShell(opts.cwd)}`;

  switch (terminal) {
    case "cmux":
      openInCmux(opts.cwd, opts.command, opts.env);
      break;
    case "iterm2":
      openInITerm2(fullCommand, mode);
      break;
    case "apple_terminal":
      openInAppleTerminal(fullCommand, mode);
      break;
    default:
      openGeneric(terminal, opts.cwd, opts.command, mode);
      break;
  }
};

const escapeAppleScript = (s: string): string => {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
};

const openInITerm2 = (command: string, mode: TerminalMode): void => {
  const action =
    mode === "tab"
      ? `
      tell current window
        create tab with default profile
        tell current session
          write text "${escapeAppleScript(command)}"
        end tell
      end tell`
      : `
      create window with default profile
      tell current session of current window
        write text "${escapeAppleScript(command)}"
      end tell`;

  const script = `
    tell application "iTerm2"
      ${action}
    end tell
  `;
  execSync(`osascript -e ${escapeShell(script)}`);
};

const openInAppleTerminal = (command: string, mode: TerminalMode): void => {
  const script =
    mode === "tab"
      ? `
    tell application "Terminal"
      activate
      tell application "System Events" to tell process "Terminal" to keystroke "t" using command down
      delay 0.3
      do script "${escapeAppleScript(command)}" in front window
    end tell`
      : `
    tell application "Terminal"
      do script "${escapeAppleScript(command)}"
      activate
    end tell`;

  execSync(`osascript -e ${escapeShell(script)}`);
};

const openInCmux = (
  cwd: string,
  command?: string,
  env?: Record<string, string>,
): void => {
  const socketPath = getCmuxSocketPath();
  const workspaceName = cwd.split("/").pop() ?? cwd;

  // Build the full shell command to send
  const envExports = env
    ? Object.entries(env)
        .map(([k, v]) => `export ${k}=${escapeShell(v)}`)
        .join(" && ")
    : "";
  const prefix = envExports ? `${envExports} && ` : "";
  const fullCommand = command
    ? `${prefix}cd ${escapeShell(cwd)} && ${command}`
    : `${prefix}cd ${escapeShell(cwd)}`;

  try {
    // Create a new workspace in cmux
    execSync(`cmux new-workspace --name ${escapeShell(workspaceName)}`, {
      env: { ...process.env, CMUX_SOCKET_PATH: socketPath },
      stdio: "pipe",
    });

    // Send the command to the new workspace
    execSync(`cmux send ${escapeShell(fullCommand)}`, {
      env: { ...process.env, CMUX_SOCKET_PATH: socketPath },
      stdio: "pipe",
    });
    execSync(`cmux send-key enter`, {
      env: { ...process.env, CMUX_SOCKET_PATH: socketPath },
      stdio: "pipe",
    });
  } catch {
    // Fall back to helpful message if cmux CLI isn't available
    console.log(
      `Could not open cmux workspace. Run manually:\n  ${fullCommand}`,
    );
  }
};

const openGeneric = (
  terminal: string,
  cwd: string,
  command?: string,
  mode?: TerminalMode,
): void => {
  // For Ghostty, Warp, and others, try to open the app with the directory
  // and use System Events to type the command
  const appName = resolveAppName(terminal);

  if (appName) {
    try {
      if (mode === "tab") {
        // Try to open a new tab via Cmd+T keystroke
        const tabScript = `
          tell application "${escapeAppleScript(appName)}" to activate
          delay 0.3
          tell application "System Events" to tell process "${escapeAppleScript(appName)}" to keystroke "t" using command down
        `;
        execSync(`osascript -e ${escapeShell(tabScript)}`);
      } else {
        execSync(`open -a ${escapeShell(appName)}`);
      }

      // Give the app a moment to open, then type the command
      if (command) {
        const fullCommand = `cd ${escapeShell(cwd)} && ${command}`;
        const script = `
          delay 0.5
          tell application "System Events"
            tell process "${escapeAppleScript(appName)}"
              keystroke "${escapeAppleScript(fullCommand)}"
              keystroke return
            end tell
          end tell
        `;
        try {
          execSync(`osascript -e ${escapeShell(script)}`);
        } catch {
          // System Events keystroke may fail without accessibility permissions
          console.log(
            `Hint: Could not type command automatically. Run manually:\n  cd ${cwd}${command ? ` && ${command}` : ""}`,
          );
        }
      }
    } catch {
      console.log(
        `Could not open terminal "${appName}". Run manually:\n  cd ${cwd}${command ? ` && ${command}` : ""}`,
      );
    }
  } else {
    // Fallback: use macOS `open` to open a new Terminal.app window
    const fullCommand = command
      ? `cd ${escapeShell(cwd)} && ${command}`
      : `cd ${escapeShell(cwd)}`;
    const script = `
      tell application "Terminal"
        do script "${escapeAppleScript(fullCommand)}"
        activate
      end tell
    `;
    execSync(`osascript -e ${escapeShell(script)}`);
  }
};

const resolveAppName = (terminal: string): string | undefined => {
  const mapping: Record<string, string> = {
    ghostty: "Ghostty",
    warp: "Warp",
  };
  return mapping[terminal];
};
