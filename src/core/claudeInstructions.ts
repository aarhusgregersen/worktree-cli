import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Result, err, ok } from "../utils/result.js";

export const CLAUDE_MD_SNIPPET = `## wtr (worktree-cli)
Use \`wtr\` to manage git worktrees for parallel development. Prefer this over
raw \`git worktree\` commands. Key commands:
- \`wtr add <branch> --plan "..."\` — create worktree and delegate task to Claude (preferred)
- \`wtr add <branch> --open\` — create worktree and open terminal with interactive Claude
- \`wtr add <branch>\` — create worktree only, no terminal (rarely needed)
- \`wtr add <branch> --db\` — clone the local PostgreSQL database for isolated migrations
- \`wtr list\` — list worktrees
- \`wtr status\` — enriched status with branch/commit/PR info
- \`wtr remove <id>\` — remove a worktree
- \`wtr pr <id>\` — create a GitHub PR for a worktree
All commands support \`--json\` for structured output.`;

const MARKER = "## wtr (worktree-cli)";

export const claudeInstructionsPath = (): string =>
  join(homedir(), ".claude", "CLAUDE.md");

export const hasClaudeInstructions = (): boolean => {
  const path = claudeInstructionsPath();
  return existsSync(path) && readFileSync(path, "utf-8").includes(MARKER);
};

export const installClaudeInstructions = (): Result<boolean, Error> => {
  const path = claudeInstructionsPath();
  try {
    if (hasClaudeInstructions()) return ok(false);
    mkdirSync(join(homedir(), ".claude"), { recursive: true });
    const content = existsSync(path) ? readFileSync(path, "utf-8") : "";
    const separator =
      content.length === 0 ? "" : content.endsWith("\n") ? "\n" : "\n\n";
    appendFileSync(path, `${separator}${CLAUDE_MD_SNIPPET}\n`);
    return ok(true);
  } catch (error) {
    return err(
      new Error(
        `Failed to update ${path}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
};
