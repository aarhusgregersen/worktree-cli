import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export type TerminalApp =
  | "iterm2"
  | "apple_terminal"
  | "ghostty"
  | "warp"
  | string;

export const detectTerminal = (): TerminalApp => {
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

export const buildClaudeCommand = (planPath?: string): string => {
  if (planPath) {
    return `claude "$(cat ${planPath})"`;
  }
  return "claude";
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
}): void => {
  const terminal = detectTerminal();
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
    case "iterm2":
      openInITerm2(fullCommand);
      break;
    case "apple_terminal":
      openInAppleTerminal(fullCommand);
      break;
    default:
      openGeneric(terminal, opts.cwd, opts.command);
      break;
  }
};

const escapeShell = (s: string): string => {
  return `'${s.replace(/'/g, "'\\''")}'`;
};

const escapeAppleScript = (s: string): string => {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
};

const openInITerm2 = (command: string): void => {
  const script = `
    tell application "iTerm2"
      create window with default profile
      tell current session of current window
        write text "${escapeAppleScript(command)}"
      end tell
    end tell
  `;
  execSync(`osascript -e ${escapeShell(script)}`);
};

const openInAppleTerminal = (command: string): void => {
  const script = `
    tell application "Terminal"
      do script "${escapeAppleScript(command)}"
      activate
    end tell
  `;
  execSync(`osascript -e ${escapeShell(script)}`);
};

const openGeneric = (terminal: string, cwd: string, command?: string): void => {
  // For Ghostty, Warp, and others, try to open the app with the directory
  // and use System Events to type the command
  const appName = resolveAppName(terminal);

  if (appName) {
    try {
      // Open the app
      execSync(`open -a ${escapeShell(appName)}`);

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
