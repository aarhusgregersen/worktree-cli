import { describe, expect, it } from "vitest";
import {
  deriveDbName,
  parseConnection,
  parseDatabaseName,
  replaceDatabaseName,
  sanitizeBranchForDb,
} from "../../src/core/database.js";

describe("parseConnection", () => {
  it("extracts host, port, user and password from a DATABASE_URL", () => {
    expect(
      parseConnection("postgresql://postgres:password@localhost:9999/cleaning"),
    ).toEqual({
      host: "localhost",
      port: "9999",
      user: "postgres",
      password: "password",
    });
  });

  it("omits fields that are absent", () => {
    expect(parseConnection("postgresql://localhost/mydb")).toEqual({
      host: "localhost",
      port: undefined,
      user: undefined,
      password: undefined,
    });
  });

  it("url-decodes user and password", () => {
    const conn = parseConnection(
      "postgres://us%40er:p%40ss%3Aword@db.example.com:5432/app",
    );
    expect(conn.user).toBe("us@er");
    expect(conn.password).toBe("p@ss:word");
    expect(conn.host).toBe("db.example.com");
    expect(conn.port).toBe("5432");
  });

  it("returns an empty object for an unparseable URL", () => {
    expect(parseConnection("not a url")).toEqual({});
  });
});

describe("parseDatabaseName", () => {
  it("reads the database name from the URL path", () => {
    expect(
      parseDatabaseName("postgresql://postgres:pw@localhost:9999/cleaning"),
    ).toBe("cleaning");
  });

  it("strips query parameters", () => {
    expect(
      parseDatabaseName("postgresql://u:p@host:5432/mydb?sslmode=require"),
    ).toBe("mydb");
  });

  it("returns undefined when there is no database name", () => {
    expect(parseDatabaseName("postgresql://host:5432/")).toBeUndefined();
  });
});

describe("replaceDatabaseName", () => {
  it("swaps the database name while preserving connection details", () => {
    expect(
      replaceDatabaseName(
        "postgresql://postgres:pw@localhost:9999/cleaning",
        "cleaning_wtr_feat",
      ),
    ).toBe("postgresql://postgres:pw@localhost:9999/cleaning_wtr_feat");
  });
});

describe("deriveDbName", () => {
  it("appends a sanitized branch suffix", () => {
    expect(deriveDbName("cleaning", "feat/auction-participation")).toBe(
      "cleaning_wtr_feat_auction_participation",
    );
  });
});

describe("sanitizeBranchForDb", () => {
  it("lowercases and collapses non-alphanumerics to single underscores", () => {
    expect(sanitizeBranchForDb("Feature/My-Branch__2")).toBe(
      "feature_my_branch_2",
    );
  });

  it("trims leading and trailing underscores", () => {
    expect(sanitizeBranchForDb("/leading/trailing/")).toBe("leading_trailing");
  });
});
