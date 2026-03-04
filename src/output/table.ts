import Table from "cli-table3";
import pc from "picocolors";
import type { WorktreeInfo } from "../core/worktree.js";
import {
  formatBranch,
  formatHead,
  formatPath,
  formatStatus,
} from "./formatter.js";

export const renderWorktreeTable = (
  worktrees: readonly WorktreeInfo[],
  includeMain: boolean,
  ages?: Map<string, string>,
): string => {
  const filtered = includeMain
    ? worktrees
    : worktrees.filter((wt) => !wt.isMain);

  if (filtered.length === 0) {
    return "No worktrees found.";
  }

  const head = [
    pc.bold("#"),
    pc.bold("Path"),
    pc.bold("Branch"),
    pc.bold("HEAD"),
    pc.bold("Status"),
  ];

  if (ages) {
    head.push(pc.bold("Activity"));
  }

  const table = new Table({
    head,
    style: {
      head: [],
      border: ["dim"],
    },
  });

  for (const [i, wt] of filtered.entries()) {
    const row: string[] = [
      pc.dim(String(i + 1)),
      formatPath(wt.path),
      wt.branch ? formatBranch(wt.branch) : pc.dim("detached"),
      formatHead(wt.head),
      formatStatus(wt),
    ];

    if (ages) {
      row.push(ages.get(wt.path) || pc.dim("--"));
    }

    table.push(row);
  }

  return table.toString();
};

export const renderWorktreeJson = (
  worktrees: readonly WorktreeInfo[],
): string => {
  return JSON.stringify(worktrees, null, 2);
};
