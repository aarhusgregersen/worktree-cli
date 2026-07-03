# Recreating Conductor's UI in zellij (staying in iTerm2)

Starter notes from exploring whether `zellij` + `lazygit` + `wtr` can approximate
Conductor's UI (repo-grouped worktree sidebar, agent pane, diff pane) without
leaving iTerm2 for Conductor / cmux / Zed.

## 1. Goal & why zellij

Conductor's UI has three ingredients worth keeping: a sidebar that groups
worktrees by repo, a main pane to talk to an agent, and a diff pane to review
what changed — all without alt-tabbing to a separate app.

Why try to rebuild this in a terminal multiplexer instead of adopting
Conductor/cmux/Zed outright:

- **Stay in iTerm2.** No new GUI app, no new keybinding muscle memory, no new
  place notifications/window management live.
- **Compose existing tools.** `wtr` already knows the worktree list and status;
  `lazygit` already does changed-files + inline diff better than anything
  worth building from scratch. zellij just needs to arrange panes.
- **Terminal-native.** Everything (agent CLI, lazygit, wtr) is already a
  terminal program — a multiplexer is the natural container, not a
  reimplementation.
- **tmux would also work**, but zellij's KDL layouts are declarative,
  versionable files (vs. tmux's shell-script-flavored config), which makes a
  repo-grouped "restore this layout" workflow simpler to author and share.

This is explicitly a **starter**, not a finished clone — see the limitations
section before investing further.

## 2. Working layout

### Install

```bash
brew install zellij lazygit jq
```

(`jq` is used by the sidebar refresh script below to parse `wtr status --json`.)

### Layout file location

Zellij looks for named layouts in `~/.config/zellij/layouts/`. Save the layout
below as:

```
~/.config/zellij/layouts/wtr-conductor.kdl
```

Launch it with:

```bash
zellij --layout wtr-conductor
```

or from inside an existing session: `zellij action new-tab --layout wtr-conductor`.

### The layout

```kdl
// ~/.config/zellij/layouts/wtr-conductor.kdl
layout {
    default_tab_template {
        pane size=1 borderless=true {
            plugin location="zellij:tab-bar"
        }
        children
        pane size=1 borderless=true {
            plugin location="zellij:status-bar"
        }
    }

    tab name="wtr" {
        pane split_direction="vertical" {
            pane size="22%" name="worktrees" command="bash" {
                args "-c" "~/.config/zellij/scripts/wtr-sidebar.sh"
            }
            pane size="53%" name="agent" focus=true
            pane size="25%" name="diff" command="lazygit"
        }
    }
}
```

- **Left (22%)** — `worktrees`: runs the refresh script below instead of a
  static command, since there's no long-running `wtr watch`.
- **Center (53%)** — `agent`: a plain shell pane, focused on launch. `cd` into
  a worktree (`cd $(wtr cd <id>)`) and start your agent CLI (e.g. `claude`)
  there.
- **Right (25%)** — `diff`: launches `lazygit` directly, giving changed-files +
  inline diff for whatever repo the pane's cwd is in.

Run `zellij setup --check` after installing if the layout fails to load — KDL
layout syntax (attribute vs. child-node placement for `command`/`args`/`cwd`)
has shifted slightly across zellij releases.

### Sidebar refresh script (repo-grouped)

`wtr status`/`wtr list` are scoped to **one** repo (the git repo containing
the cwd) — there's no multi-repo mode built in. To get a "repo-grouped"
sidebar like Conductor's, group repos yourself in a small polling script:

```bash
#!/usr/bin/env bash
# ~/.config/zellij/scripts/wtr-sidebar.sh
set -euo pipefail

REPOS=(
  "$HOME/code/repo-a"
  "$HOME/code/repo-b"
)

while true; do
  clear
  for repo in "${REPOS[@]}"; do
    [[ -d "$repo" ]] || continue
    echo "== $(basename "$repo") =="
    (cd "$repo" && wtr status --json 2>/dev/null) \
      | jq -r '.[] | "  \(.branch // "detached")  ahead:\(.ahead)  dirty:\(.dirty)  pr:#\(.pr.number // "-")  claude:\(.claude)"' \
      || echo "  (not a wtr repo, or no worktrees)"
    echo
  done
  sleep 3
done
```

```bash
chmod +x ~/.config/zellij/scripts/wtr-sidebar.sh
```

Edit `REPOS` to the repos you want grouped. Confirmed `wtr status --json`
shape (from `src/commands/status.ts`), one object per non-main worktree:

```json
{
  "path": "/Users/you/code/repo-a-worktrees/feature-auth",
  "branch": "feature/auth",
  "isMain": false,
  "head": "abc1234",
  "ahead": 3,
  "diff": { "filesChanged": 5, "insertions": 42, "deletions": 7 },
  "dirty": true,
  "untrackedCount": 2,
  "pushed": true,
  "pr": { "number": 12, "title": "Add auth", "url": "...", "state": "OPEN", "isDraft": false },
  "claude": true,
  "lastCommit": "2h ago"
}
```

(`wtr list --json` gives the leaner `WorktreeInfo` shape — `path`, `head`,
`branch`, `isLocked`, `isPrunable`, `isMain`, `isDetached`, plus `lastCommit` —
if you want a faster, PR-lookup-free refresh loop instead.)

Jumping the agent pane into a worktree the sidebar just showed:

```bash
cd $(wtr cd feature/auth)   # by branch name
cd $(wtr cd 2)              # by # from `wtr ls`
```

## 3. Honest limitations vs. Conductor

- **No clickable tree view.** zellij panes are terminal text — the left pane
  is a plain-text list that redraws every few seconds, not an interactive
  tree you click to switch worktrees. Switching still means typing
  `cd $(wtr cd <id>)` in the agent pane (or scripting a keybinding for it —
  see next steps).
- **Polling, not push.** The sidebar re-runs `wtr status --json` on a timer
  (3s above). There's no file-watcher/event push, so it's laggier than
  Conductor's live UI and does a fresh `git`/`gh` round-trip per repo per
  tick — `wtr status --no-pr` or a longer interval helps if that's noisy.
  (`--no-pr` skips the `gh` PR lookup specifically.)
  There is no `wtr watch` subcommand today.
  Note: `wtr status` does a GitHub PR lookup per worktree unless `--no-pr` is
  passed — worth doing in the sidebar loop to avoid rate limits/latency across
  multiple repos on a fast poll interval.
- **No cross-repo `wtr` command.** Repo-grouping is entirely in the wrapper
  script above; `wtr` itself only ever sees the repo of its cwd.
  `wtr` also has no daemon/notification mode, so "something changed" has to
  be discovered by re-polling, not told to you.
  If it existed, `wtr status --watch` would remove the polling script.
- **No selection state.** Conductor's sidebar knows which worktree is
  "selected" and updates the other panes accordingly. Here, the sidebar pane
  and the agent/diff panes are independent — nothing auto-switches `lazygit`
  or the agent pane's cwd when you eyeball a different row in the sidebar.
- **Colors may be muted.** `wtr status`'s table/colors depend on TTY detection
  and terminal width; a narrow 22%-width pane will wrap or truncate the
  table. `--json` piped through `jq` (as above) avoids that but loses the
  nice table formatting.

Bottom line: this gets you the *arrangement* (sidebar + agent + diff, one
tmux/zellij session, no context switch to another app) but not the
*interactivity* (click-to-select, live push updates, unified selection
state). It's a reasonable terminal-native approximation, not a replacement.

## 4. Next steps

1. Install `zellij`, `lazygit`, `jq`; save the layout and script above.
2. Edit `REPOS` in `wtr-sidebar.sh` to your actual repo paths.
3. Launch with `zellij --layout wtr-conductor` from iTerm2 and sanity-check
   all three panes render (sidebar text, empty shell, lazygit).
4. In the agent pane, try the `cd $(wtr cd <id>)` workflow end-to-end against
   a real worktree before relying on it daily.
5. Tune the sidebar poll interval and consider `--no-pr` if the GitHub calls
   feel slow across multiple repos.
6. If click-to-select bothers you, look at zellij keybindings/plugins for a
   fuzzy-picker action that runs `wtr cd` and re-focuses the agent pane —
   that's the biggest interactivity gap to close next.
7. Optional: file/consider a `wtr status --watch` (push-based, no polling)
   and a multi-repo `wtr status --json` mode if this workflow sticks —
   would remove the biggest hacks in this doc (the polling loop and the
   hardcoded `REPOS` array).
