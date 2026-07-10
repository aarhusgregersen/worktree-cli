---
name: wtr
description: Manages git worktrees using the wtr CLI. Activates when working with multiple branches in parallel, creating worktrees, reviewing sibling worktrees, checking status, diffing, creating PRs, or cleaning up merged worktrees.
allowed-tools: Bash(wtr *), Bash(git worktree *), Bash(gh pr *), Read, Grep, Glob
argument-hint: [subcommand or question]
---

# wtr — Git Worktree Manager

`wtr` manages git worktrees with smart environment setup (file copying, port bumping) and LLM-friendly structured output.

**Always use `wtr` instead of raw `git worktree` commands.** It handles env file copying, port bumping, and structured output that `git worktree` does not.

## Rules

1. **Pass `--json` for informational commands** — use `--json` with: `list`, `status`, `diff`, `pr`, `remove`, `clean`, `init`, `current`, `cd`, `exec`, `each`, `sync`. **Omit `--json` when opening terminals** (`wtr add --plan`, `wtr add --open`, `wtr open --claude`, `wtr open --plan`) so that `wtr` spawns the terminal window directly via osascript.
2. **Never use raw `git worktree`** — always use `wtr` which wraps it with env setup and structured output.
3. **`wtr add` must run from the main worktree** — it will refuse to run from inside a non-main worktree.
4. **Always use `--open` or `--plan` when creating worktrees from an existing session** — when the user asks you to spin up a worktree for a task, always include `--open` (for interactive Claude) or `--plan` (to delegate with instructions). This opens a new terminal automatically so the user can seamlessly continue in the new worktree without manual steps. Omit these flags only when the user explicitly says they don't want a terminal opened.
5. **Handoff after opening Claude in a worktree** — After running `wtr add --open`, `wtr add --plan`, `wtr open --claude`, or `wtr open --plan`, the task has been delegated to the new terminal. Do NOT continue implementing the delegated task. Inform the user that work has been handed off (include branch name and path) and ask if there's anything else to work on.

## Am I in a Worktree?

Check for the `WT_ACTIVE` environment variable. When Claude is launched inside a worktree (via `wtr open --claude` or `wtr add --plan`), these env vars are set:

| Variable | Value |
|----------|-------|
| `WT_ACTIVE` | `"1"` — present means you're in a worktree |
| `WT_NAME` | Directory name of this worktree |
| `WT_BRANCH` | Branch name |
| `WT_PATH` | Full absolute path |

```bash
echo $WT_ACTIVE  # "1" if in a worktree, empty if not
```

You can also use `wtr current --json` to get full details about the current worktree.

## Quick Reference

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `wtr add <branch>` | Create a new worktree | `--json`, `--open`, `--plan <text>`, `--plan -`, `--db [name]` |
| `wtr list` | List all worktrees | `--json`, `-a`, `--porcelain` |
| `wtr status` | Enriched status of all worktrees | `--json`, `--no-pr` |
| `wtr current` | Show current worktree | `--json` |
| `wtr cd <id>` | Print worktree path (for shell `cd`) | `--json` |
| `wtr exec <id> <cmd...>` | Run command in a worktree | `--json` |
| `wtr each <cmd...>` | Run command in every worktree | `--json`, `--bail`, `--include-main` |
| `wtr sync [id]` | Sync worktree(s) with default branch | `--json`, `--all`, `--merge`, `--no-fetch` |
| `wtr diff <id>` | Show diff for a worktree | `--stat`, `--uncommitted`, `--json` |
| `wtr open <id>` | Open worktree in new terminal | `--claude`, `--plan <text>`, `--plan -`, `--json` |
| `wtr pr <id>` | Create PR for a worktree | `--title`, `--body`, `--draft`, `--json` |
| `wtr db clone [name]` | Clone the DB for the current worktree | `--json` |
| `wtr db drop` | Drop the cloned DB for the current worktree | `--json`, `-y` |
| `wtr db status` | Show DB info for the current worktree | `--json` |
| `wtr remove <id>` | Remove a worktree | `--json`, `--delete-branch`, `-y` |
| `wtr clean` | Prune stale entries + remove merged worktrees (both by default) | `--dangling`, `--merged`, `--dry-run`, `--delete-branches`, `--force`, `--json`, `-y` |
| `wtr init` | Initialize wtr config for repo | `--json`, `-y` |
| `wtr completions [shell]` | Generate shell completions | `bash`, `zsh`, `fish` |

The `<id>` can be a worktree number (from `wtr list`), branch name, or path.

## Error Codes

All `--json` error output now includes a machine-readable `code` field:

```json
{ "error": "Worktree not found: foo", "code": "WORKTREE_NOT_FOUND" }
```

**Codes:** `NOT_GIT_REPOSITORY`, `NOT_INITIALIZED`, `WORKTREE_NOT_FOUND`, `BRANCH_EXISTS`, `BRANCH_NOT_FOUND`, `CANNOT_REMOVE_MAIN`, `WORKTREE_LOCKED`, `GH_NOT_AVAILABLE`, `INSIDE_WORKTREE`, `NOT_INSIDE_WORKTREE`, `EXEC_FAILED`, `SYNC_FAILED`, `IDENTIFIER_REQUIRED`.

## Common Workflows

### Check what's happening across all worktrees

```bash
wtr status --json
```

Returns an array with each worktree's branch, commits ahead, diff stats, dirty state, push status, PR info, whether Claude is active, and last commit activity.

### Read files in a sibling worktree

Use the `path` from `wtr list --json` to browse files in other worktrees with Read, Glob, and Grep. Each worktree is a full working directory on disk.

```bash
wtr list --json   # get the path for the worktree you want to inspect
```

Then use Read/Glob/Grep with that path to explore the code — no need to switch branches.

### Review a sibling worktree's changes

```bash
# Summary of changes
wtr diff 1 --stat --json

# Full diff
wtr diff 1 --json

# Uncommitted changes only
wtr diff 1 --uncommitted --json
```

### Create a worktree and start working

**Always prefer `--open` or `--plan` when the user asks you to create a worktree.** This opens a new terminal so the user seamlessly lands in the worktree with Claude ready.

**Interactive — continue planning with Claude:**

```bash
wtr add feature/auth --open
```

This creates the worktree and opens a new terminal with Claude running interactively. Use this when you're still exploring the problem or want to plan collaboratively with Claude before implementing.

**With a plan — delegate implementation:**

```bash
# Inline plan text
wtr add feature/auth --plan "Implement JWT authentication middleware"

# Plan from stdin (useful for long plans)
echo "detailed plan..." | wtr add feature/auth --plan -

# Or from a file
wtr add feature/auth --plan-file /path/to/plan.md
```

This creates the worktree, opens a new terminal, and starts Claude with the given plan so implementation begins immediately. Use this to parallelize independent work across multiple worktrees.

Both commands open terminals via osascript inside `wtr`'s own process — no nested Claude session is created. **Omit `--json`** so the terminal opens directly.

> **After handoff:** Once these commands complete, this session should NOT continue implementing the task. The new terminal has its own Claude session. Report the handoff to the user and wait for further instructions.

You can also launch Claude in an existing worktree:

```bash
wtr open 2 --claude             # interactive
wtr open 2 --plan "Fix the failing tests"  # with a plan
```

> **When to use `--json`:** Pass `--json` only when you need structured output without opening a terminal (e.g., for agentic pipelines). With `--json`, `wtr add --plan` returns the command/planPath fields without opening anything.

### Run commands across worktrees

```bash
# Run a command in a specific worktree
wtr exec 1 npm test --json

# Run tests in every worktree, stop on first failure
wtr each npm test --bail

# Git status across all worktrees
wtr each git status
```

### Sync worktrees with upstream

```bash
# Sync current worktree (auto-detected from cwd)
wtr sync

# Sync all worktrees
wtr sync --all --json

# Use merge instead of rebase
wtr sync --merge
```

### Navigate to a worktree

```bash
# Print path for shell cd
cd $(wtr cd 2)
cd $(wtr cd feature/auth)

# Check which worktree you're in
wtr current --json
```

### Check which worktrees have Claude active

```bash
wtr status --json   # check the "claude" field on each entry
```

The `claude` field is `true` when a Claude process is running with its cwd inside that worktree. Use this to see what's already being worked on before delegating tasks.

### Create a PR when done

```bash
wtr pr 1 --title "Add my feature" --draft --json
```

This pushes the branch (if needed) and creates a draft PR.

### Clean up after merge

```bash
# See what would be removed (stale + merged)
wtr clean --dry-run --json

# Prune stale entries and remove merged worktrees + their branches
wtr clean --delete-branches --json

# Scope to just one phase
wtr clean --merged --delete-branches --json   # only merged worktrees
wtr clean --dangling --json                   # only stale entries
```

## Port Awareness

When `wtr init` is configured, each worktree gets ports bumped by `portOffset * worktreeIndex`. For example with offset 100:
- Worktree #2: PORT=3000 becomes PORT=3100
- Worktree #3: PORT=3000 becomes PORT=3200

External service ports (DATABASE_URL, REDIS_URL, etc.) are never changed.

## Database Isolation

When worktrees involve database migrations or schema changes, use `--db` to clone the PostgreSQL database so each worktree has its own isolated copy:

```bash
# Auto-derive name from branch (e.g. myapp_dev_wtr_feature_auth)
wtr add feature/auth --db --plan "Add auth tables"

# Explicit database name
wtr add feature/auth --db my_custom_db --open
```

This runs `createdb <new> -T <template>` using the database found in `DATABASE_URL` from the worktree's `.env` files, then updates `DATABASE_URL` to point at the clone. On `wtr remove`, the cloned database is automatically dropped.

You can also add database isolation after the fact, from inside an existing worktree:

```bash
# Clone the DB for the current worktree (auto-derives name from branch)
wtr db clone

# Clone with an explicit name
wtr db clone my_custom_db

# Check what DB this worktree uses
wtr db status

# Drop the cloned DB (without removing the worktree)
wtr db drop
```

**Note:** The template database must have no active connections when cloning. Close any running dev servers or database tools connected to it before cloning.

## Decision Guide

| Situation | Command |
|-----------|---------|
| "What worktrees exist?" | `wtr list --json` |
| "What's the state of all branches?" | `wtr status --json` |
| "What changed in worktree 2?" | `wtr diff 2 --stat --json` |
| "Which worktree am I in?" | `wtr current --json` |
| "Is there a PR for this branch?" | `wtr status --json` (check `pr` field) |
| "Is Claude already working on something?" | `wtr status --json` (check `claude` field) |
| "Create a PR for worktree 1" | `wtr pr 1 --title "..." --json` |
| "Clean up merged branches" | `wtr clean --merged --delete-branches --json` |
| "Start a new parallel task (interactive)" | `wtr add feature/name --open` (no `--json`) |
| "Delegate a task to another Claude" | `wtr add feature/name --plan "..."` (no `--json`) |
| "Work on migrations in isolation" | `wtr add feature/name --db --plan "..."` (no `--json`) |
| "Add DB isolation to current worktree" | `wtr db clone` |
| "What database am I using?" | `wtr db status --json` |
| "Open Claude in an existing worktree" | `wtr open 2 --claude` (no `--json`) |
| "Run tests in worktree 1" | `wtr exec 1 npm test --json` |
| "Run tests in all worktrees" | `wtr each npm test --bail` |
| "Sync all worktrees with main" | `wtr sync --all --json` |
| "Navigate to worktree 2" | `cd $(wtr cd 2)` |
| "Remove a specific worktree" | `wtr remove 2 --delete-branch --json` |
| "Read code in another worktree" | `wtr list --json`, then Read/Glob/Grep with the path |

## JSON Output Schemas

See [reference/json-schemas.md](reference/json-schemas.md) for the full JSON output schema of every command.
