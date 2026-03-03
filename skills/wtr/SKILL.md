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

1. **Pass `--json` for informational commands** — use `--json` with: `list`, `status`, `diff`, `pr`, `remove`, `cleanup`, `prune`, `init`. **Omit `--json` when opening terminals** (`wtr add --plan`, `wtr add --open`, `wtr open --claude`, `wtr open --plan`) so that `wtr` spawns the terminal window directly via osascript.
2. **Never use raw `git worktree`** — always use `wtr` which wraps it with env setup and structured output.
3. **`wtr add` must run from the main worktree** — it will refuse to run from inside a non-main worktree.

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

## Quick Reference

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `wtr add <branch>` | Create a new worktree | `--json`, `--open`, `--plan <text>` |
| `wtr list` | List all worktrees | `--json`, `-a` |
| `wtr status` | Enriched status of all worktrees | `--json`, `--no-pr` |
| `wtr diff <id>` | Show diff for a worktree | `--stat`, `--uncommitted`, `--json` |
| `wtr open <id>` | Open worktree in new terminal | `--claude`, `--plan <text>`, `--json` |
| `wtr pr <id>` | Create PR for a worktree | `--title`, `--body`, `--draft`, `--json` |
| `wtr remove <id>` | Remove a worktree | `--json`, `--delete-branch`, `-y` |
| `wtr cleanup` | Remove worktrees with merged branches | `--dry-run`, `--json`, `--delete-branches` |
| `wtr prune` | Clean up stale worktree entries | `--merged`, `--json`, `-y` |
| `wtr init` | Initialize wtr config for repo | `--json`, `-y` |

The `<id>` can be a worktree number (from `wtr list`), branch name, or path.

## Common Workflows

### Check what's happening across all worktrees

```bash
wtr status --json
```

Returns an array with each worktree's branch, commits ahead, diff stats, dirty state, push status, PR info, and whether Claude is active in it.

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

There are two workflows for spinning up a new worktree with Claude:

**Interactive — continue planning with Claude:**

```bash
wtr add feature/auth --open
```

This creates the worktree and opens a new terminal with Claude running interactively. Use this when you're still exploring the problem or want to plan collaboratively with Claude before implementing.

**With a plan — delegate implementation:**

```bash
# Inline plan text
wtr add feature/auth --plan "Implement JWT authentication middleware"

# Or from a file
wtr add feature/auth --plan-file /path/to/plan.md
```

This creates the worktree, opens a new terminal, and starts Claude with the given plan so implementation begins immediately. Use this to parallelize independent work across multiple worktrees.

Both commands open terminals via osascript inside `wtr`'s own process — no nested Claude session is created. **Omit `--json`** so the terminal opens directly.

You can also launch Claude in an existing worktree:

```bash
wtr open 2 --claude             # interactive
wtr open 2 --plan "Fix the failing tests"  # with a plan
```

> **When to use `--json`:** Pass `--json` only when you need structured output without opening a terminal (e.g., for agentic pipelines). With `--json`, `wtr add --plan` returns the command/planPath fields without opening anything.

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
# See what would be removed
wtr cleanup --dry-run --json

# Remove merged worktrees and their branches
wtr cleanup --delete-branches --json
```

## Port Awareness

When `wtr init` is configured, each worktree gets ports bumped by `portOffset * worktreeIndex`. For example with offset 100:
- Worktree #2: PORT=3000 becomes PORT=3100
- Worktree #3: PORT=3000 becomes PORT=3200

External service ports (DATABASE_URL, REDIS_URL, etc.) are never changed.

## Decision Guide

| Situation | Command |
|-----------|---------|
| "What worktrees exist?" | `wtr list --json` |
| "What's the state of all branches?" | `wtr status --json` |
| "What changed in worktree 2?" | `wtr diff 2 --stat --json` |
| "Is there a PR for this branch?" | `wtr status --json` (check `pr` field) |
| "Is Claude already working on something?" | `wtr status --json` (check `claude` field) |
| "Create a PR for worktree 1" | `wtr pr 1 --title "..." --json` |
| "Clean up merged branches" | `wtr cleanup --delete-branches --json` |
| "Start a new parallel task (interactive)" | `wtr add feature/name --open` (no `--json`) |
| "Delegate a task to another Claude" | `wtr add feature/name --plan "..."` (no `--json`) |
| "Open Claude in an existing worktree" | `wtr open 2 --claude` (no `--json`) |
| "Remove a specific worktree" | `wtr remove 2 --delete-branch --json` |
| "Read code in another worktree" | `wtr list --json`, then Read/Glob/Grep with the path |

## JSON Output Schemas

See [reference/json-schemas.md](reference/json-schemas.md) for the full JSON output schema of every command.
