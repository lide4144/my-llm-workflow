import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig, validateConfig } from "../src/config.js";
import type { WorkflowConfig } from "../src/config.js";

// ─── Helpers ────────────────────────────────────────────────────

function tempDir(prefix: string): string {
  const dir = join(tmpdir(), `mw-test-${prefix}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfig(dir: string, data: unknown): string {
  const path = join(dir, "workflow.config.json");
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  return path;
}

const VALID_CONFIG: Record<string, unknown> = {
  outputDir: "docs/superpowers",
  stages: {
    brainstorming: {
      model: "anthropic/claude-sonnet-4-20250514",
      thinking: "high",
      skill: "brainstorming",
      onFailure: "stop",
    },
    "writing-plans": {
      model: "openai/gpt-4o",
      thinking: "medium",
      skill: "writing-plans",
      onFailure: "stop",
    },
    "executing-plans": {
      model: "anthropic/claude-haiku-3-5-20241022",
      thinking: "off",
      skill: "subagent-driven-development",
      onFailure: "continue",
    },
    verification: {
      model: "anthropic/claude-sonnet-4-20250514",
      thinking: "low",
      skill: "verification-before-completion",
      onFailure: "continue",
    },
  },
};

// ─── Tests ───────────────────────────────────────────────────────

describe("loadConfig", () => {
  it("加载有效完整配置文件，返回解析后的 WorkflowConfig", async () => {
    const dir = tempDir("valid");
    const path = writeConfig(dir, VALID_CONFIG);

    const config = await loadConfig(path);

    expect(config).toBeDefined();
    expect(config.outputDir).toBe("docs/superpowers");
    expect(Object.keys(config.stages)).toHaveLength(4);

    const b = config.stages.brainstorming;
    expect(b.model).toBe("anthropic/claude-sonnet-4-20250514");
    expect(b.thinking).toBe("high");
    expect(b.skill).toBe("brainstorming");
    expect(b.onFailure).toBe("stop");
  });
});

describe("validateConfig", () => {
  it("空 stages 对象抛出明确错误", () => {
    expect(() =>
      validateConfig({ outputDir: "out", stages: {} })
    ).toThrow(/stage/i);
  });

  it("stage 缺少 model 字段抛出明确错误", () => {
    expect(() =>
      validateConfig({
        outputDir: "out",
        stages: { brainstorming: { thinking: "high" } },
      })
    ).toThrow(/model/i);
  });
});
