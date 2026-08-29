import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseEnvAssignment,
  rewriteEnvFiles,
} from "../../src/core/envDocument.js";

const directories: string[] = [];

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "wtr-env-document-"));
  directories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("parseEnvAssignment", () => {
  it("preserves export, whitespace, quotes, and comments", () => {
    const assignment = parseEnvAssignment(
      `  export DATABASE_URL = "postgres://localhost/old" # local`,
    );
    expect(assignment?.key).toBe("DATABASE_URL");
    expect(assignment?.value).toBe("postgres://localhost/old");
    expect(assignment?.render("postgres://localhost/new")).toBe(
      `  export DATABASE_URL = "postgres://localhost/new" # local`,
    );
  });
});

describe("rewriteEnvFiles", () => {
  it("preserves CRLF and only rewrites changed assignments", () => {
    const directory = temporaryDirectory();
    const path = join(directory, ".env");
    writeFileSync(path, "APP_PORT='3000'\r\n# keep\r\nDEBUG=true\r\n");
    const result = rewriteEnvFiles(directory, (assignment) =>
      assignment.key === "APP_PORT" ? "3100" : undefined,
    );
    expect(result.ok).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe(
      "APP_PORT='3100'\r\n# keep\r\nDEBUG=true\r\n",
    );
  });
});
