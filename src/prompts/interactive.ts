import * as p from "@clack/prompts";
import pc from "picocolors";
import type { WorktreeInfo } from "../core/worktree.js";

export const selectWorktree = async (
  worktrees: readonly WorktreeInfo[],
): Promise<WorktreeInfo> => {
  const nonMain = worktrees.filter((wt) => !wt.isMain);

  if (nonMain.length === 0) {
    p.cancel("No worktrees found.");
    process.exit(1);
  }

  const result = await p.select({
    message: "Select a worktree",
    options: nonMain.map((wt) => ({
      value: wt,
      label: wt.branch ?? wt.path,
      hint: wt.path,
    })),
  });

  if (p.isCancel(result)) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }

  return result as WorktreeInfo;
};

export const confirmDestructive = async (
  message: string,
  options?: {
    initialValue?: boolean;
    activeLabel?: string;
    inactiveLabel?: string;
  },
): Promise<boolean> => {
  const result = await p.confirm({
    message: pc.yellow(message),
    initialValue: options?.initialValue ?? false,
    active: options?.activeLabel,
    inactive: options?.inactiveLabel,
  });

  if (p.isCancel(result)) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }

  return result;
};

export const confirm = async (
  message: string,
  initialValue = true,
): Promise<boolean> => {
  const result = await p.confirm({
    message,
    initialValue,
  });

  if (p.isCancel(result)) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }

  return result;
};

export const selectMultiple = async <T extends string>(
  message: string,
  options: { value: T; label: string; hint?: string }[],
  initialValues?: T[],
): Promise<T[]> => {
  const result = await p.multiselect({
    message,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: options as any,
    initialValues,
    required: false,
  });

  if (p.isCancel(result)) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }

  return result as T[];
};

export const textInput = async (
  message: string,
  options?: {
    placeholder?: string;
    defaultValue?: string;
    validate?: (value: string) => string | undefined;
  },
): Promise<string> => {
  const result = await p.text({
    message,
    placeholder: options?.placeholder,
    defaultValue: options?.defaultValue,
    validate: options?.validate,
  });

  if (p.isCancel(result)) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }

  return result;
};

export const numberInput = async (
  message: string,
  defaultValue: number,
): Promise<number> => {
  const result = await p.text({
    message,
    defaultValue: String(defaultValue),
    validate: (value) => {
      const num = Number.parseInt(value, 10);
      if (Number.isNaN(num) || num < 0) {
        return "Please enter a valid positive number";
      }
    },
  });

  if (p.isCancel(result)) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }

  return Number.parseInt(result, 10);
};

export const spinner = () => p.spinner();

export const intro = (message: string): void => {
  p.intro(pc.bgCyan(pc.black(` ${message} `)));
};

export const outro = (message: string): void => {
  p.outro(message);
};

export const note = (message: string, title?: string): void => {
  p.note(message, title);
};

export const log = {
  info: (message: string) => p.log.info(message),
  success: (message: string) => p.log.success(message),
  warning: (message: string) => p.log.warning(message),
  error: (message: string) => p.log.error(message),
  message: (message: string) => p.log.message(message),
};
