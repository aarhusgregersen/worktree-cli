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
): string => {
  const filtered = includeMain
    ? worktrees
    : worktrees.filter((wt) => !wt.isMain);

  if (filtered.length === 0) {
    return "No worktrees found.";
  }

  const table = new Table({
    head: [
      pc.bold("#"),
      pc.bold("Path"),
      pc.bold("Branch"),
      pc.bold("HEAD"),
      pc.bold("Status"),
    ],
    style: {
      head: [],
      border: ["dim"],
    },
  });

  for (const [i, wt] of filtered.entries()) {
    table.push([
      pc.dim(String(i + 1)),
      formatPath(wt.path),
      wt.branch ? formatBranch(wt.branch) : pc.dim("detached"),
      formatHead(wt.head),
      formatStatus(wt),
    ]);
  }

  return table.toString();
};

export const renderWorktreeJson = (
  worktrees: readonly WorktreeInfo[],
): string => {
  return JSON.stringify(worktrees, null, 2);
};
