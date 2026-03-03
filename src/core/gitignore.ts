import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface GitignoreSuggestion {
  readonly pattern: string;
  readonly reason: string;
  readonly recommended: boolean;
}

const COMMON_CONFIG_PATTERNS = [
  { pattern: ".env", reason: "Environment variables", recommended: true },
  {
    pattern: ".env.local",
    reason: "Local environment overrides",
    recommended: true,
  },
  {
    pattern: ".env.development",
    reason: "Development environment",
    recommended: true,
  },
  {
    pattern: ".env.development.local",
    reason: "Local dev overrides",
    recommended: true,
  },
  {
    pattern: ".claude/settings.local.json",
    reason: "Claude Code local settings",
    recommended: true,
  },
  {
    pattern: ".vscode/",
    reason: "VS Code workspace settings",
    recommended: false,
  },
  { pattern: ".idea/", reason: "JetBrains IDE settings", recommended: false },
  { pattern: ".cursor/", reason: "Cursor IDE settings", recommended: false },
] as const;

const INTERESTING_GITIGNORE_PATTERNS = [
  /^\.env/i,
  /^\..*rc$/i,
  /config.*local/i,
  /\.local$/i,
  /secrets?/i,
  /credentials?/i,
];

export const parseGitignore = (repoRoot: string): string[] => {
  const gitignorePath = join(repoRoot, ".gitignore");

  if (!existsSync(gitignorePath)) {
    return [];
  }

  const content = readFileSync(gitignorePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
};

export const getSuggestions = (repoRoot: string): GitignoreSuggestion[] => {
  const gitignorePatterns = parseGitignore(repoRoot);
  const suggestions: GitignoreSuggestion[] = [];
  const seen = new Set<string>();

  for (const common of COMMON_CONFIG_PATTERNS) {
    if (fileOrDirExists(repoRoot, common.pattern)) {
      suggestions.push(common);
      seen.add(common.pattern);
    }
  }

  for (const pattern of gitignorePatterns) {
    if (seen.has(pattern)) continue;

    const isInteresting = INTERESTING_GITIGNORE_PATTERNS.some((regex) =>
      regex.test(pattern),
    );

    if (isInteresting && fileOrDirExists(repoRoot, pattern)) {
      suggestions.push({
        pattern,
        reason: "Found in .gitignore",
        recommended: pattern.toLowerCase().includes("env"),
      });
      seen.add(pattern);
    }
  }

  return suggestions;
};

const fileOrDirExists = (repoRoot: string, pattern: string): boolean => {
  const cleanPattern = pattern.replace(/\/$/, "").replace(/^\*\*\//, "");

  if (cleanPattern.includes("*")) {
    return false;
  }

  return existsSync(join(repoRoot, cleanPattern));
};
