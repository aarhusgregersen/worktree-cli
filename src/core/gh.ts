import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Result, err, ok } from "../utils/result.js";
import { executeGitCommand } from "./git.js";

const execFileAsync = promisify(execFile);

export interface PrInfo {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly isDraft: boolean;
}

export interface CreatePrOptions {
  readonly title: string;
  readonly body?: string;
  readonly draft?: boolean;
  readonly cwd?: string;
}

let ghAvailable: boolean | null = null;

export const isGhAvailable = async (): Promise<boolean> => {
  if (ghAvailable !== null) return ghAvailable;
  try {
    await execFileAsync("gh", ["--version"]);
    ghAvailable = true;
  } catch {
    ghAvailable = false;
  }
  return ghAvailable;
};

export const isPrMerged = async (
  branch: string,
  cwd?: string,
): Promise<boolean> => {
  const pr = await getPrForBranch(branch, cwd);
  return pr?.state === "MERGED";
};

export const getPrForBranch = async (
  branch: string,
  cwd?: string,
): Promise<PrInfo | null> => {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "view", branch, "--json", "number,title,url,state,isDraft"],
      { cwd },
    );
    return JSON.parse(stdout.trim()) as PrInfo;
  } catch {
    return null;
  }
};

export const createPr = async (
  options: CreatePrOptions,
): Promise<Result<PrInfo, Error>> => {
  const args = ["pr", "create", "--title", options.title];

  if (options.body) {
    args.push("--body", options.body);
  } else {
    args.push("--body", "");
  }

  if (options.draft) {
    args.push("--draft");
  }

  try {
    const { stdout } = await execFileAsync("gh", args, { cwd: options.cwd });
    const url = stdout.trim();

    // Fetch the created PR info
    const pr = await getPrForBranch("HEAD", options.cwd);
    if (pr) return ok(pr);

    // Fallback: parse URL for number
    const match = url.match(/\/pull\/(\d+)$/);
    return ok({
      number: match?.[1] ? Number.parseInt(match[1], 10) : 0,
      title: options.title,
      url,
      state: options.draft ? "DRAFT" : "OPEN",
      isDraft: options.draft ?? false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(new Error(message));
  }
};

export const pushBranch = async (
  branch: string,
  cwd?: string,
): Promise<Result<void, Error>> => {
  const result = await executeGitCommand(["push", "-u", "origin", branch], {
    cwd,
  });
  return result.ok ? ok(undefined) : result;
};
