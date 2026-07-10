# wtr — Git Worktree Manager

CLI tool for managing git worktrees with smart environment setup, port bumping, and Claude Code integration.

## Installation

```bash
npm install -g @aarhusgregersen/worktree-cli
```

Requires Node.js >= 20 and git.

## Quick Start

```bash
# Initialize in your repo
wtr init

# Create a worktree (auto-creates branch, copies env files, bumps ports)
wtr add feature/auth

# List worktrees
wtr list

# Check status of all worktrees
wtr status

# Open a worktree in a new terminal with Claude Code
wtr add feature/login --open

# Remove when done
wtr remove feature/auth
```

## Commands

### `wtr init`

Initialize wtr for the current repository. Scans for common config files (.env, .vscode/, etc.) and creates `.wtr.json`.

```bash
wtr init          # Interactive setup
wtr init -y       # Use defaults
wtr init --json   # JSON output
```

### `wtr add <branch> [path]`

Create a new worktree. Automatically creates the branch if it doesn't exist, copies config files, and bumps ports.

```bash
wtr add feature/auth                    # Create worktree
wtr add feature/auth --open             # Create and open terminal with Claude
wtr add feature/auth --plan "Add JWT"   # Create, open, and start Claude with a plan
echo "plan" | wtr add feature/x --plan -  # Read plan from stdin
wtr add feature/auth --base develop     # Branch from develop
wtr add feature/auth --no-copy          # Skip file copying
wtr add feature/auth --no-bump          # Skip port bumping
wtr add feature/auth --json             # JSON output
```

### `wtr list`

List all worktrees with path, branch, HEAD, status, and last activity.

```bash
wtr list            # Table format (excludes main)
wtr ls -a           # Include main worktree
wtr list --json     # JSON output (includes lastCommit)
wtr list --porcelain  # Tab-separated for scripting
```

### `wtr status`

Show enriched status: ahead count, diff stats, dirty state, push status, PR info, Claude activity, and last commit.

```bash
wtr status          # Table format
wtr st -a           # Include main worktree
wtr status --no-pr  # Skip PR lookups (faster)
wtr status --json   # JSON output
```

### `wtr current`

Show which worktree you're currently in.

```bash
wtr current         # Human output: branch @ /path (abc1234)
wtr current --json  # JSON: { path, branch, isMain, head }
```

### `wtr cd <id>`

Print a worktree's path. Designed for shell integration:

```bash
cd $(wtr cd 2)                  # cd to worktree #2
cd $(wtr cd feature/auth)       # cd by branch name
```

### `wtr exec <id> <cmd...>`

Run a command inside a worktree directory. Sets `WT_*` environment variables.

```bash
wtr exec 1 git status          # Run git status in worktree #1
wtr exec feature/auth npm test  # Run tests in a specific worktree
wtr exec 2 ls --json           # JSON output with captured stdout/stderr
```

### `wtr each <cmd...>`

Run a command in every non-main worktree sequentially.

```bash
wtr each git status             # Status of all worktrees
wtr each npm test --bail        # Run tests, stop on first failure
wtr each git pull --include-main  # Include main worktree
wtr each npm test --json        # JSON output with all results
```

### `wtr sync [id]`

Sync worktree(s) with the default branch via rebase (default) or merge.

```bash
wtr sync              # Sync current worktree (auto-detect from cwd)
wtr sync 1            # Sync worktree #1
wtr sync --all        # Sync all non-main worktrees
wtr sync --merge      # Use merge instead of rebase
wtr sync --no-fetch   # Skip git fetch origin
wtr sync --json       # JSON output
```

### `wtr open [id]`

Open a worktree in a new terminal window. Supports iTerm2, Apple Terminal, Ghostty, and Warp.

```bash
wtr open 1                           # Open worktree #1
wtr open feature/auth --claude       # Open with Claude Code
wtr open 1 --plan "Implement auth"   # Open with Claude and a plan
echo "plan" | wtr open 1 --plan -   # Read plan from stdin
wtr open 1 --json                    # JSON (doesn't open terminal)
```

### `wtr diff [id]`

Show diff for a worktree against the default branch.

```bash
wtr diff 1              # Full diff
wtr diff 1 --stat       # Diffstat summary
wtr diff 1 --uncommitted  # Working tree changes
wtr diff 1 --base develop  # Diff against specific branch
```

### `wtr pr [id]`

Create a GitHub pull request for a worktree. Requires [GitHub CLI](https://cli.github.com).

```bash
wtr pr 1                    # Interactive PR creation
wtr pr 1 --title "Add auth" --draft  # Create draft PR
wtr pr 1 --json             # JSON output
```

### `wtr remove [id]`

Remove a worktree and optionally delete the branch.

```bash
wtr remove 1                  # Interactive removal
wtr rm 1 -y                   # Skip confirmation
wtr remove 1 --delete-branch  # Also delete branch
wtr remove 1 --force          # Force remove (locked/dirty)
```

### `wtr clean`

Clean up a repo in one command. By default it does **both**: prunes stale
worktree entries (directories that no longer exist on disk) **and** removes
worktrees whose branches have been merged — detected via git merge **or** a
merged GitHub PR (so squash-merges count too).

```bash
wtr clean                     # Prune stale + remove merged (both)
wtr clean --dangling          # Only prune stale entries
wtr clean --merged            # Only remove merged worktrees
wtr clean --dry-run           # Preview only, no changes
wtr clean --delete-branches   # Also delete the associated branches
wtr clean --force -y          # Include dirty worktrees, skip confirmation
```

Worktrees with uncommitted changes are skipped unless `--force` is given.

### `wtr completions [shell]`

Generate shell completions. Auto-detects shell from `$SHELL`.

```bash
# Bash
wtr completions bash >> ~/.bashrc

# Zsh
wtr completions zsh > ~/.zfunc/_wtr

# Fish
wtr completions fish > ~/.config/fish/completions/wtr.fish
```

## Configuration

### Local: `.wtr.json`

Created by `wtr init` in the repository root. Add to `.gitignore`.

```json
{
  "copyFiles": [".env", ".env.local", ".vscode/settings.json"],
  "portOffset": 100,
  "portExclusions": [],
  "terminal": {
    "mode": "window",
    "autoMode": false,
    "focus": false
  }
}
```

### Global: `~/.wt/config.json`

Fallback configuration used when no local `.wtr.json` exists.

### Fields

| Field | Default | Description |
|-------|---------|-------------|
| `copyFiles` | `[]` | File/directory patterns to copy from main worktree |
| `portOffset` | `100` | Port increment per worktree index |
| `portExclusions` | `[]` | Additional port variable patterns to exclude from bumping |
| `terminal.mode` | `"window"` | `"window"` or `"tab"` — how new sessions open |
| `terminal.autoMode` | `false` | Pass `--permission-mode auto` when launching Claude |
| `terminal.focus` | `false` | If `true`, the new terminal window steals focus. Default keeps focus on your current app. |

### Port Bumping

Ports in `.env` files are automatically incremented based on worktree index:

- Worktree #2: PORT=3000 becomes PORT=3100
- Worktree #3: PORT=3000 becomes PORT=3200

**Built-in exclusions** (never bumped): DATABASE, DB_PORT, POSTGRES, PG_, MYSQL, MONGO, REDIS, CACHE, QUEUE, RABBIT, KAFKA, ELASTIC, OPENSEARCH, MEMCACHE.

Add custom exclusions via `portExclusions`:

```json
{
  "portExclusions": ["SMTP", "LDAP"]
}
```

## JSON Mode & Error Codes

All commands support `--json` for structured output. Errors include machine-readable codes:

```json
{
  "error": "Worktree not found: foo",
  "code": "WORKTREE_NOT_FOUND"
}
```

**Error codes:** `NOT_GIT_REPOSITORY`, `NOT_INITIALIZED`, `WORKTREE_NOT_FOUND`, `BRANCH_EXISTS`, `BRANCH_NOT_FOUND`, `CANNOT_REMOVE_MAIN`, `WORKTREE_LOCKED`, `GH_NOT_AVAILABLE`, `INSIDE_WORKTREE`, `NOT_INSIDE_WORKTREE`, `EXEC_FAILED`, `SYNC_FAILED`, `IDENTIFIER_REQUIRED`.

## Claude Code Integration

`wtr` is designed to work well with [Claude Code](https://claude.com/claude-code):

- **`--json`** on all commands provides structured output for programmatic use
- **Error codes** let Claude handle specific failures gracefully
- **`wtr current --json`** tells Claude which worktree it's in
- **`wtr exec <id> <cmd>`** runs commands in worktrees with `WT_*` env vars
- **`--plan`** flags pipe instructions directly to Claude Code
- **`wtr each`** runs commands across all worktrees

### Setup

Running `wtr init` will offer to add wtr instructions to `~/.claude/CLAUDE.md` so that Claude Code always knows how to use `wtr` correctly — including preferring `--plan` or `--open` when creating worktrees. This is recommended for all users.

If you skipped this during init, you can add the following to `~/.claude/CLAUDE.md` manually:

```markdown
## wtr (worktree-cli)
Use `wtr` to manage git worktrees for parallel development. Prefer this over
raw `git worktree` commands. Key commands:
- `wtr add <branch> --plan "..."` — create worktree and delegate task to Claude (preferred)
- `wtr add <branch> --open` — create worktree and open terminal with interactive Claude
- `wtr add <branch>` — create worktree only, no terminal (rarely needed)
- `wtr list` — list worktrees
- `wtr status` — enriched status with branch/commit/PR info
- `wtr remove <id>` — remove a worktree
- `wtr pr <id>` — create a GitHub PR for a worktree
All commands support `--json` for structured output.

When creating a worktree, almost always use `--plan` (if you have instructions to
delegate) or `--open` (if interactive exploration is needed). Using bare `wtr add`
without either flag is rare — only do it when the user explicitly doesn't want a
terminal opened. After `--plan` or `--open`, hand off and do NOT continue the
delegated task in the current session.
```

### Example: Claude Code Workflow

```bash
# Create worktree with a plan for Claude
wtr add feature/auth --plan "Implement JWT authentication with refresh tokens"

# Check what Claude is working on
wtr status

# Sync all worktrees with main
wtr sync --all

# Clean up after merge
wtr clean -y --delete-branches
```

## Environment Variables

When opening terminals or running commands, `wtr` sets:

| Variable | Description |
|----------|-------------|
| `WT_ACTIVE` | Always `1` when inside a wtr-managed terminal |
| `WT_NAME` | Directory name of the worktree |
| `WT_BRANCH` | Branch name |
| `WT_PATH` | Absolute path to the worktree |

## License

MIT
