import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

export const buildClaudeCommand = (opts?: {
  planPath?: string;
  autoMode?: boolean;
}): string => {
  const flags = opts?.autoMode === true ? " --permission-mode auto" : "";
  if (opts?.planPath) {
    return `claude${flags} "$(cat ${escapeShell(opts.planPath)})"`;
  }
  return `claude${flags}`;
};

// Shell command that emits an OSC 7 escape sequence reporting the current
// working directory.  Terminals (iTerm2, Apple Terminal, Ghostty, …) use
// this to track the cwd so that "new tab in same directory" works even when
// a long-running process like `claude` prevents the shell from updating it.
const OSC7_PRINTF = `printf '\\033]7;file://%s%s\\033\\\\' "$(hostname)" "$(pwd)"`;

// Write a temp shell script that the new terminal launches as its initial
// command. Avoids TTY injection (`write text` / `do script` / keystrokes), so
// stray keystrokes from the user typing during the focus shift cannot
// interleave with the command being delivered to the new shell. After the
// command exits we `exec` the user's interactive shell so the window remains
// usable in the worktree directory.
const writeLauncherScript = (opts: {
  cwd: string;
  env?: Record<string, string>;
  command?: string;
}): string => {
  const filename = `wtr-launch-${randomUUID()}.sh`;
  const filepath = join("/tmp", filename);

  const lines: string[] = ["#!/bin/bash", ""];

  // Inherit PATH from the wtr process. Terminal.app / iTerm2 are GUI-launched
  // and start child shells with a minimal PATH that lacks Homebrew, pnpm,
  // fnm, etc. — so `claude` and friends would not resolve. Carry the user's
  // PATH from the wtr process (which was started from an interactive shell)
  // into the new session.
  if (process.env.PATH) {
    lines.push(`export PATH=${escapeShell(process.env.PATH)}`);
  }

  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      lines.push(`export ${k}=${escapeShell(v)}`);
    }
  }

  lines.push(`cd ${escapeShell(opts.cwd)}`);
  lines.push(OSC7_PRINTF);

  if (opts.command) {
    lines.push(opts.command);
  }

  lines.push('exec "${SHELL:-/bin/bash}"');

  writeFileSync(filepath, `${lines.join("\n")}\n`, "utf-8");
  chmodSync(filepath, 0o755);
  return filepath;
};

export const openTerminalWindow = (opts: {
  readonly cwd: string;
  readonly command?: string;
  readonly env?: Record<string, string>;
  readonly mode?: TerminalMode;
  readonly focus?: boolean;
}): void => {
  const terminal = detectTerminal();
  const mode = opts.mode ?? "window";
  const focus = opts.focus ?? false;

  if (terminal === "cmux") {
    // cmux sends commands to an already-running session over a socket — no
    // new window is created, so the focus/injection problem doesn't apply.
    openInCmux(opts.cwd, opts.command, opts.env);
    return;
  }

  const scriptPath = writeLauncherScript({
    cwd: opts.cwd,
    env: opts.env,
    command: opts.command,
  });

  switch (terminal) {
    case "iterm2":
      openInITerm2(scriptPath, mode, focus);
      break;
    case "apple_terminal":
      openInAppleTerminal(scriptPath, mode, focus);
      break;
    default:
      openGeneric(terminal, scriptPath, mode, focus);
      break;
  }
};

// Wrap an AppleScript so the previously-frontmost app keeps focus after the
// new terminal window is opened. The capture must happen before any `activate`
// or `do script` call, since those steal focus immediately.
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

const escapeAppleScript = (s: string): string => {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
};

const openInITerm2 = (
  scriptPath: string,
  mode: TerminalMode,
  focus: boolean,
): void => {
  // Use iTerm2's `command` parameter so the new session execs our launcher
  // script directly — no `write text` / TTY injection that could interleave
  // with the user's typing during the brief focus shift.
  const escaped = escapeAppleScript(scriptPath);
  const action =
    mode === "tab"
      ? `
      tell current window
        create tab with default profile command "${escaped}"
      end tell`
      : `
      create window with default profile command "${escaped}"`;

  const inner = `
    tell application "iTerm2"
      ${action}
    end tell
  `;
  execSync(`osascript -e ${escapeShell(wrapPreserveFocus(inner, focus))}`);
};

const openInAppleTerminal = (
  scriptPath: string,
  mode: TerminalMode,
  focus: boolean,
): void => {
  if (mode === "window") {
    // `open -a Terminal <script>` makes Terminal run the script as a new
    // window session — the shell execs the script directly, so there's no
    // TTY injection. The `-g` flag keeps focus on the previously frontmost
    // app.
    const flag = focus ? "-a" : "-ga";
    execSync(`open ${flag} Terminal ${escapeShell(scriptPath)}`);
    return;
  }

  // Tab mode: AppleScript has no clean way to open a new tab and run a
  // script without keystroke + injection. We type the path (short string —
  // less prone to interleave damage than a multi-line command) and accept
  // the limitation.
  const inner = `
    tell application "Terminal"
      activate
      tell application "System Events" to tell process "Terminal" to keystroke "t" using command down
      delay 0.3
      do script "${escapeAppleScript(scriptPath)}" in front window
    end tell
  `;
  execSync(`osascript -e ${escapeShell(wrapPreserveFocus(inner, focus))}`);
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
  scriptPath: string,
  mode: TerminalMode | undefined,
  focus: boolean,
): void => {
  // For Ghostty, Warp, and others, try to open the app with the directory
  // and use System Events to type the command
  const appName = resolveAppName(terminal);

  if (appName === "Ghostty") {
    // Ghostty supports launching with an initial command via `--command=`.
    // Same benefit as iTerm2: the shell execs our script, no TTY injection.
    const flag = focus ? "-a" : "-ga";
    try {
      execSync(
        `open ${flag} Ghostty --args --command=${escapeShell(scriptPath)}`,
      );
      return;
    } catch {
      // Fall through to legacy keystroke approach if --args isn't accepted
    }
  }

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

      // Capture the previously-frontmost app *after* the terminal app has
      // taken focus (we need it focused to receive keystrokes), so we can
      // restore focus once the keystrokes are sent.
      let previousApp: string | undefined;
      if (!focus) {
        try {
          previousApp = execSync(
            `osascript -e 'tell application "System Events" to return name of first application process whose frontmost is true and name is not "${escapeAppleScript(appName)}"'`,
            { encoding: "utf-8" },
          ).trim();
        } catch {
          // Couldn't determine — skip restore
        }
      }

      // Type the launcher script path (much shorter than a full command —
      // less prone to corruption if a stray keystroke from the user
      // interleaves while the new window is grabbing focus).
      const script = `
        delay 0.5
        tell application "System Events"
          tell process "${escapeAppleScript(appName)}"
            keystroke "${escapeAppleScript(scriptPath)}"
            keystroke return
          end tell
        end tell
      `;
      try {
        execSync(`osascript -e ${escapeShell(script)}`);
      } catch {
        // System Events keystroke may fail without accessibility permissions
        console.log(
          `Hint: Could not type command automatically. Run manually:\n  ${scriptPath}`,
        );
      }

      if (previousApp) {
        try {
          execSync(
            `osascript -e ${escapeShell(`tell application "${escapeAppleScript(previousApp)}" to activate`)}`,
          );
        } catch {
          // Best effort
        }
      }
    } catch {
      console.log(
        `Could not open terminal "${appName}". Run manually:\n  ${scriptPath}`,
      );
    }
  } else {
    // Fallback: open the launcher script with Terminal.app via `open`. The
    // script execs the worktree command directly — no TTY injection.
    const flag = focus ? "-a" : "-ga";
    execSync(`open ${flag} Terminal ${escapeShell(scriptPath)}`);
  }
};

const resolveAppName = (terminal: string): string | undefined => {
  const mapping: Record<string, string> = {
    ghostty: "Ghostty",
    warp: "Warp",
  };
  return mapping[terminal];
};
