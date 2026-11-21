import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Result, err, ok } from "../utils/result.js";
import { executeGitCommand, getRepoId } from "./git.js";
import { cachePrs, getCachedPr } from "./prCache.js";

const execFileAsync = promisify(execFile);

export interface PrInfo {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly isDraft: boolean;
  readonly headRefOid?: string;
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

export interface PrLookupOptions {
  readonly cwd?: string;
  // How stale a cached lookup may be; 0 always refetches.
  readonly maxAgeMs?: number;
}

// Large repos can trip GraphQL query complexity limits with too many aliases.
const BRANCHES_PER_QUERY = 50;
const PR_FIELDS = "number title url state isDraft headRefOid isCrossRepository";

const buildPrQuery = (count: number): string => {
  const indexes = Array.from({ length: count }, (_, i) => i);
  const variables = indexes.map((i) => `$b${i}: String!`).join(", ");
  const fields = indexes
    .map(
      (i) =>
        `b${i}: pullRequests(headRefName: $b${i}, first: 5, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { ${PR_FIELDS} } }`,
    )
    .join(" ");
  return `query($owner: String!, $name: String!, ${variables}) { repository(owner: $owner, name: $name) { ${fields} } }`;
};

interface PrNode extends PrInfo {
  readonly isCrossRepository: boolean;
}

interface PrQueryResponse {
  readonly data: {
    readonly repository: Record<string, { readonly nodes: readonly PrNode[] }>;
  };
}

// Mirrors `gh pr view <branch>`: fork PRs are ignored, and an open PR wins over older closed/merged ones.
const pickPr = (nodes: readonly PrNode[]): PrInfo | null => {
  const sameRepo = nodes.filter((pr) => !pr.isCrossRepository);
  const picked =
    sameRepo.find((pr) => pr.state === "OPEN") ?? sameRepo[0] ?? null;
  if (!picked) return null;
  const { isCrossRepository: _, ...pr } = picked;
  return pr;
};

const fetchPrChunk = async (
  branches: readonly string[],
  cwd?: string,
): Promise<ReadonlyMap<string, PrInfo | null>> => {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "api",
        "graphql",
        "-F",
        "owner={owner}",
        "-F",
        "name={repo}",
        "-f",
        `query=${buildPrQuery(branches.length)}`,
        ...branches.flatMap((branch, i) => ["-f", `b${i}=${branch}`]),
      ],
      { cwd },
    );
    const { repository } = (JSON.parse(stdout) as PrQueryResponse).data;
    return new Map(
      branches.map((branch, i) => [
        branch,
        pickPr(repository[`b${i}`]?.nodes ?? []),
      ]),
    );
  } catch {
    return new Map();
  }
};

// Branches missing from the result could not be looked up (gh missing,
// unauthenticated, not a GitHub repo) — distinct from a known "no PR" (null).
export const getPrsForBranches = async (
  branches: readonly string[],
  { cwd, maxAgeMs = 0 }: PrLookupOptions = {},
): Promise<ReadonlyMap<string, PrInfo | null>> => {
  if (branches.length === 0) return new Map();
  const repoId = await getRepoId(cwd);

  const result = new Map<string, PrInfo | null>();
  const missing: string[] = [];
  for (const branch of new Set(branches)) {
    const cached = getCachedPr(repoId, branch, maxAgeMs);
    if (cached) result.set(branch, cached.pr);
    else missing.push(branch);
  }
  if (missing.length === 0) return result;

  const chunks = Array.from(
    { length: Math.ceil(missing.length / BRANCHES_PER_QUERY) },
    (_, i) =>
      missing.slice(i * BRANCHES_PER_QUERY, (i + 1) * BRANCHES_PER_QUERY),
  );
  const fetched = new Map(
    (
      await Promise.all(chunks.map((chunk) => fetchPrChunk(chunk, cwd)))
    ).flatMap((chunk) => [...chunk]),
  );
  if (fetched.size > 0) cachePrs(repoId, fetched);

  for (const [branch, pr] of fetched) result.set(branch, pr);
  return result;
};

export const getPrForBranch = async (
  branch: string,
  cwd?: string,
): Promise<PrInfo | null> => {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "pr",
        "view",
        branch,
        "--json",
        "number,title,url,state,isDraft,headRefOid",
      ],
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
