import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("配置文件不存在时抛出明确错误", async () => {
    const dir = tempDir("missing");
    const path = join(dir, "nonexistent.json");

    await expect(loadConfig(path)).rejects.toThrow(/not found|不存在|ENOENT/i);
  });

  it("配置文件 JSON 语法错误时抛出明确错误", async () => {
    const dir = tempDir("invalid-json");
    const path = join(dir, "bad.json");
    writeFileSync(path, "{ invalid json }", "utf-8");

    await expect(loadConfig(path)).rejects.toThrow(/JSON|parse/i);
  });

  it("最小配置（只有 model）能正确加载，可选字段为 undefined", async () => {
    const dir = tempDir("minimal");
    const path = writeConfig(dir, {
      outputDir: "out",
      stages: { test: { model: "anthropic/claude-sonnet-4-20250514" } },
    });

    const config = await loadConfig(path);

    expect(config.stages.test.model).toBe("anthropic/claude-sonnet-4-20250514");
    expect(config.stages.test.thinking).toBeUndefined();
    expect(config.stages.test.skill).toBeUndefined();
    expect(config.stages.test.onFailure).toBeUndefined();
    expect(config.stages.test.label).toBeUndefined();
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

  it("无效的 thinking level 抛出明确错误", () => {
    expect(() =>
      validateConfig({
        outputDir: "out",
        stages: { test: { model: "x/y", thinking: "turbo" } },
      })
    ).toThrow(/thinking/i);
  });

  it("无效的 onFailure 值抛出明确错误", () => {
    expect(() =>
      validateConfig({
        outputDir: "out",
        stages: { test: { model: "x/y", onFailure: "abort" } },
      })
    ).toThrow(/onFailure/i);
  });

  it("outputDir 为空字符串时抛出错误", () => {
    expect(() =>
      validateConfig({ outputDir: "", stages: { test: { model: "x/y" } } })
    ).toThrow(/outputDir/i);
  });
});
