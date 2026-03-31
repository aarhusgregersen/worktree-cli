# wtr JSON Output Schemas

All commands support `--json`. Errors output `{ "error": "message", "code": "ERROR_CODE" }` to stderr. The `code` field is present for well-known errors (see Error Codes below).

## Error Format

```json
{
  "error": "Worktree not found: foo",
  "code": "WORKTREE_NOT_FOUND"
}
```

## `wtr list --json`

```json
[
  {
    "path": "/path/to/worktree",
    "head": "abc1234...",
    "branch": "feature/auth",
    "isLocked": false,
    "isPrunable": false,
    "isMain": false,
    "isDetached": false,
    "lastCommit": "2026-03-04T10:00:00+00:00"
  }
]
```

## `wtr status --json`

```json
[
  {
    "path": "/path/to/worktree",
    "branch": "feature/auth",
    "isMain": false,
    "head": "abc1234...",
    "ahead": 3,
    "diff": {
      "filesChanged": 5,
      "insertions": 42,
      "deletions": 8
    },
    "dirty": false,
    "untrackedCount": 0,
    "pushed": true,
    "pr": {
      "number": 12,
      "title": "Add auth",
      "url": "https://github.com/org/repo/pull/12",
      "state": "OPEN",
      "isDraft": false
    },
    "claude": false,
    "lastCommit": "2 hours ago"
  }
]
```

The `pr` field is `null` when no PR exists or `--no-pr` is used.

## `wtr add <branch> --json`

```json
{
  "path": "/path/to/worktree",
  "branch": "feature/auth",
  "branchCreated": true,
  "filesCopied": [".env", ".env.local"],
  "portsBumped": [
    {
      "file": ".env",
      "changes": [
        { "key": "PORT", "oldPort": 3000, "newPort": 3100 }
      ]
    }
  ],
  "portOffset": 100,
  "database": { "name": "myapp_dev_wtr_feature_auth", "template": "myapp_dev" },
  "command": "claude \"$(cat /tmp/wtr-plan-xxx.md)\"",
  "planPath": "/tmp/wtr-plan-xxx.md"
}
```

The `command` and `planPath` fields are only present when `--plan` or `--plan-file` is used. `portOffset` is the total offset applied. The `database` field is only present when `--db` is used.

## `wtr current --json`

```json
{
  "path": "/path/to/worktree",
  "branch": "feature/auth",
  "isMain": false,
  "head": "abc1234..."
}
```

## `wtr cd <id> --json`

```json
{
  "path": "/path/to/worktree",
  "branch": "feature/auth"
}
```

## `wtr exec <id> <cmd...> --json`

```json
{
  "path": "/path/to/worktree",
  "branch": "feature/auth",
  "exitCode": 0,
  "stdout": "...",
  "stderr": ""
}
```

## `wtr each <cmd...> --json`

```json
{
  "results": [
    {
      "path": "/path/to/worktree",
      "branch": "feature/auth",
      "exitCode": 0,
      "stdout": "...",
      "stderr": ""
    }
  ]
}
```

## `wtr sync --json`

```json
{
  "defaultBranch": "main",
  "strategy": "rebase",
  "results": [
    {
      "path": "/path/to/worktree",
      "branch": "feature/auth",
      "success": true
    },
    {
      "path": "/path/to/other",
      "branch": "feature/old",
      "success": false,
      "error": "CONFLICT (content): Merge conflict in src/app.ts"
    }
  ]
}
```

## `wtr remove <id> --json`

```json
{
  "path": "/path/to/worktree",
  "branch": "feature/auth",
  "removed": true,
  "branchDeleted": false,
  "databaseDropped": true,
  "database": "myapp_dev_wtr_feature_auth"
}
```

## `wtr db clone [name] --json`

```json
{
  "database": "myapp_dev_wtr_feature_auth",
  "template": "myapp_dev",
  "path": "/path/to/worktree",
  "updatedFiles": [".env"]
}
```

## `wtr db drop --json`

```json
{
  "database": "myapp_dev_wtr_feature_auth",
  "dropped": true,
  "path": "/path/to/worktree"
}
```

## `wtr db status --json`

```json
{
  "path": "/path/to/worktree",
  "clonedDatabase": "myapp_dev_wtr_feature_auth",
  "databaseUrl": "postgresql://user:pass@localhost:5432/myapp_dev_wtr_feature_auth",
  "databaseKey": "DATABASE_URL"
}
```

The `clonedDatabase` field is `null` if no database has been cloned for this worktree.

## `wtr open <id> --json`

Does NOT open a terminal. Returns what would run:

```json
{
  "path": "/path/to/worktree",
  "branch": "feature/auth",
  "command": "claude \"$(cat /tmp/plan-xxx.md)\"",
  "env": {
    "WT_ACTIVE": "1",
    "WT_NAME": "worktree",
    "WT_BRANCH": "feature/auth",
    "WT_PATH": "/path/to/worktree"
  }
}
```

The `command` field is `null` if no `--claude` or `--plan` flag was given.

## `wtr diff <id> --json`

Without `--stat`:

```json
{
  "baseBranch": "main",
  "branch": "feature/auth",
  "path": "/path/to/worktree",
  "diff": "diff --git a/file.ts ..."
}
```

With `--stat`:

```json
{
  "baseBranch": "main",
  "branch": "feature/auth",
  "path": "/path/to/worktree",
  "stat": {
    "filesChanged": 3,
    "insertions": 10,
    "deletions": 5,
    "files": ["src/a.ts", "src/b.ts", "src/c.ts"]
  }
}
```

With `--uncommitted`, adds `"uncommitted": true` to the output.

## `wtr pr <id> --json`

```json
{
  "existed": false,
  "pushed": true,
  "pr": {
    "number": 15,
    "title": "Add auth",
    "url": "https://github.com/org/repo/pull/15",
    "state": "OPEN",
    "isDraft": true
  }
}
```

When a PR already exists, `existed` is `true` and `pushed` is `false`.

## `wtr cleanup --json`

```json
{
  "candidates": [
    {
      "path": "/path/to/worktree",
      "branch": "feature/done",
      "reason": "branch merged",
      "dirty": false
    }
  ],
  "removed": [
    {
      "path": "/path/to/worktree",
      "branch": "feature/done",
      "branchDeleted": true
    }
  ],
  "skipped": [
    {
      "path": "/path/to/dirty-worktree",
      "branch": "feature/wip",
      "reason": "uncommitted changes"
    }
  ]
}
```

With `--dry-run`, `removed` is always empty.

## `wtr prune --json`

```json
{
  "pruned": ["stale-entry-1", "stale-entry-2"],
  "mergedRemoved": [
    {
      "path": "/path/to/worktree",
      "branch": "feature/old",
      "branchDeleted": true
    }
  ]
}
```

The `mergedRemoved` array is only populated when `--merged` is used.

## `wtr init --json`

```json
{
  "configPath": "/path/to/repo/.wtr.json",
  "config": {
    "copyFiles": [".env", ".env.local"],
    "portOffset": 100,
    "portExclusions": []
  },
  "gitignoreUpdated": true
}
```
