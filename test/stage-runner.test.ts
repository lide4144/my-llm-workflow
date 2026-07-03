import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStage, type StageResult, type AgentFactory } from "../src/stage-runner.js";
import type { StageConfig } from "../src/config.js";

// ─── Mock Agent Factory ──────────────────────────────────────────

function createMockAgentFactory(results?: {
  outputText?: string;
  throwOnPrompt?: boolean;
  cost?: number;
}): AgentFactory {
  const cost = results?.cost ?? 0.05;
  return {
    createSession: vi.fn().mockResolvedValue({
      prompt: vi.fn().mockImplementation(async function (this: any, text: string) {
        if (results?.throwOnPrompt) {
          throw new Error("模拟 agent 错误");
        }
        // 模拟流式输出
        this._output = results?.outputText ?? "# 设计文档\n\n这是一个模拟的产物内容。";
      }),
      subscribe: vi.fn().mockImplementation((cb: any) => {
        // 模拟一个 text_delta 事件
        cb({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: "模拟输出",
          },
        });
        return () => {};
      }),
      dispose: vi.fn(),
      _output: undefined as string | undefined,
      model: { provider: "anthropic", id: "claude-sonnet-4" },
    }),
  };
}

// ─── Helpers ────────────────────────────────────────────────────

let outputDir: string;

beforeEach(() => {
  outputDir = join(tmpdir(), `mw-test-stage-${Date.now()}`);
  mkdirSync(outputDir, { recursive: true });
});

const VALID_STAGE_CONFIG: StageConfig = {
  model: "anthropic/claude-sonnet-4-20250514",
  thinking: "high",
  skill: "brainstorming",
  onFailure: "stop",
};

// ─── Tests ───────────────────────────────────────────────────────

describe("runStage", () => {
  it("成功执行一个阶段，返回 status: success", async () => {
    const factory = createMockAgentFactory();
    const result = await runStage(
      {
        stage: "brainstorming",
        config: VALID_STAGE_CONFIG,
        context: "做一个番茄钟 CLI",
        modelRef: "anthropic/claude-sonnet-4-20250514",
        outputDir,
      },
      factory
    );

    expect(result.status).toBe("success");
    expect(result.stage).toBe("brainstorming");
    expect(result.model).toBe("anthropic/claude-sonnet-4-20250514");
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(typeof result.cost).toBe("number");
  });

  it("阶段执行失败时返回 status: failure + error 信息", async () => {
    const factory = createMockAgentFactory({ throwOnPrompt: true });
    const result = await runStage(
      {
        stage: "brainstorming",
        config: VALID_STAGE_CONFIG,
        context: "test",
        modelRef: "anthropic/claude-sonnet-4-20250514",
        outputDir,
      },
      factory
    );

    expect(result.status).toBe("failure");
    expect(result.error).toBeDefined();
  });

  it("session 的 dispose 在成功后也被调用", async () => {
    const factory = createMockAgentFactory();
    const result = await runStage(
      {
        stage: "brainstorming",
        config: VALID_STAGE_CONFIG,
        context: "test",
        modelRef: "anthropic/claude-sonnet-4-20250514",
        outputDir,
      },
      factory
    );

    const session = await factory.createSession();
    expect(session.dispose).toHaveBeenCalled();
  });

  it("session 的 dispose 在失败后也被调用", async () => {
    const factory = createMockAgentFactory({ throwOnPrompt: true });
    const result = await runStage(
      {
        stage: "brainstorming",
        config: VALID_STAGE_CONFIG,
        context: "test",
        modelRef: "anthropic/claude-sonnet-4-20250514",
        outputDir,
      },
      factory
    );

    const session = await factory.createSession();
    expect(session.dispose).toHaveBeenCalled();
  });

  it("产物保存到 outputDir/stageName/ 目录下", async () => {
    const factory = createMockAgentFactory({ outputText: "# 设计文档\n方案一：..." });
    const result = await runStage(
      {
        stage: "brainstorming",
        config: VALID_STAGE_CONFIG,
        context: "做一个番茄钟",
        modelRef: "anthropic/claude-sonnet-4-20250514",
        outputDir,
      },
      factory
    );

    const stageDir = join(outputDir, "brainstorming");
    expect(existsSync(stageDir)).toBe(true);
    const files = result.artifacts;
    expect(files.length).toBeGreaterThan(0);
    // 至少有一个产物文件
    expect(files.some((f) => f.includes("brainstorming"))).toBe(true);
  });

  it("onOutput 回调接收输出文本", async () => {
    const factory = createMockAgentFactory();
    const onOutput = vi.fn();

    await runStage(
      {
        stage: "brainstorming",
        config: VALID_STAGE_CONFIG,
        context: "test",
        modelRef: "anthropic/claude-sonnet-4-20250514",
        outputDir,
        onOutput,
      },
      factory
    );

    expect(onOutput).toHaveBeenCalled();
  });
});
