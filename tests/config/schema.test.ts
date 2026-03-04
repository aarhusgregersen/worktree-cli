import { describe, expect, it } from "vitest";
import { isExcludedPort } from "../../src/config/schema.js";

describe("isExcludedPort", () => {
  it("excludes DATABASE_PORT by default", () => {
    expect(isExcludedPort("DATABASE_PORT", [])).toBe(true);
  });

  it("excludes REDIS_PORT by default", () => {
    expect(isExcludedPort("REDIS_PORT", [])).toBe(true);
  });

  it("excludes PG_PORT by default", () => {
    expect(isExcludedPort("PG_PORT", [])).toBe(true);
  });

  it("excludes POSTGRES_PORT by default", () => {
    expect(isExcludedPort("POSTGRES_PORT", [])).toBe(true);
  });

  it("excludes MONGO_PORT by default", () => {
    expect(isExcludedPort("MONGO_PORT", [])).toBe(true);
  });

  it("excludes KAFKA_PORT by default", () => {
    expect(isExcludedPort("KAFKA_PORT", [])).toBe(true);
  });

  it("excludes ELASTIC_PORT by default", () => {
    expect(isExcludedPort("ELASTIC_PORT", [])).toBe(true);
  });

  it("excludes MEMCACHE_PORT by default", () => {
    expect(isExcludedPort("MEMCACHE_PORT", [])).toBe(true);
  });

  it("does NOT exclude PORT", () => {
    expect(isExcludedPort("PORT", [])).toBe(false);
  });

  it("does NOT exclude API_PORT", () => {
    expect(isExcludedPort("API_PORT", [])).toBe(false);
  });

  it("does NOT exclude APP_PORT", () => {
    expect(isExcludedPort("APP_PORT", [])).toBe(false);
  });

  it("excludes custom exclusions", () => {
    expect(isExcludedPort("CUSTOM_PORT", ["CUSTOM"])).toBe(true);
  });

  it("is case insensitive for custom exclusions", () => {
    expect(isExcludedPort("custom_port", ["CUSTOM"])).toBe(true);
  });

  it("is case insensitive for var name", () => {
    expect(isExcludedPort("database_port", [])).toBe(true);
  });
});
