/**
 * Agent provider-config tests. The sanitizers run against pasted-in field
 * values, so these cover the mistakes people actually make: copying a whole
 * `.env` line into Model, or the full endpoint URL into Base URL.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  getAgentConfig,
  sanitizeBaseUrl,
  sanitizeModel,
  saveAgentConfig,
} from "../agent";
import { Db } from "../db";

let db: Db;

beforeEach(() => {
  db = new Db(":memory:");
});

describe("sanitizeModel", () => {
  test("passes a clean model through untouched", () => {
    expect(sanitizeModel("gemini-2.0-flash")).toBe("gemini-2.0-flash");
    expect(sanitizeModel("claude-opus-5")).toBe("claude-opus-5");
  });

  test("strips a pasted NAME= prefix", () => {
    expect(sanitizeModel("GEMINI_MODEL=gemini-2.0-flash")).toBe(
      "gemini-2.0-flash",
    );
  });

  test("strips quotes and whitespace", () => {
    expect(sanitizeModel('  "gemini-2.5-flash"  ')).toBe("gemini-2.5-flash");
  });
});

describe("sanitizeBaseUrl", () => {
  test("passes a clean root through untouched", () => {
    expect(
      sanitizeBaseUrl(
        "https://generativelanguage.googleapis.com/v1beta/openai",
      ),
    ).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
  });

  test("trims a trailing slash", () => {
    expect(sanitizeBaseUrl("https://api.groq.com/openai/v1/")).toBe(
      "https://api.groq.com/openai/v1",
    );
  });

  test("strips a pasted /chat/completions suffix", () => {
    expect(
      sanitizeBaseUrl("https://api.groq.com/openai/v1/chat/completions"),
    ).toBe("https://api.groq.com/openai/v1");
  });

  test("strips quotes", () => {
    expect(sanitizeBaseUrl('"https://api.groq.com/openai/v1"')).toBe(
      "https://api.groq.com/openai/v1",
    );
  });
});

describe("saveAgentConfig", () => {
  test("stores sanitized values", () => {
    saveAgentConfig(db, {
      provider: "custom",
      baseUrl: "https://example.com/v1/chat/completions/",
      model: "GEMINI_MODEL=gemini-2.0-flash",
      apiKey: "  secret  ",
    });
    const cfg = getAgentConfig(db);
    expect(cfg.baseUrl).toBe("https://example.com/v1");
    expect(cfg.model).toBe("gemini-2.0-flash");
    expect(cfg.apiKey).toBe("secret");
  });

  test("an empty apiKey keeps the previously stored one", () => {
    saveAgentConfig(db, { provider: "custom", apiKey: "first" });
    saveAgentConfig(db, { model: "some-model", apiKey: "" });
    expect(getAgentConfig(db).apiKey).toBe("first");
  });
});
