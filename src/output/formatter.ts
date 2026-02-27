import pc from "picocolors";

export const formatPath = (path: string): string => pc.cyan(path);
export const formatBranch = (branch: string): string => pc.green(branch);
export const formatError = (message: string): string =>
  pc.red(`Error: ${message}`);
export const formatWarning = (message: string): string =>
  pc.yellow(`Warning: ${message}`);
export const formatSuccess = (message: string): string =>
  pc.green(`${message}`);
export const formatInfo = (message: string): string => pc.blue(`${message}`);
export const formatDim = (message: string): string => pc.dim(message);

export const formatStatus = (status: {
  readonly isLocked: boolean;
  readonly isPrunable: boolean;
}): string => {
  const parts: string[] = [];

  if (status.isLocked) parts.push(pc.red("locked"));
  if (status.isPrunable) parts.push(pc.dim("prunable"));

  if (parts.length === 0) return pc.green("clean");
  return parts.join(", ");
};

export const formatHead = (head: string): string => {
  return pc.dim(head.substring(0, 7));
};
