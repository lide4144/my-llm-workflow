import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWorkflow, type WorkflowReport, type StageRunner, type StageResult } from "../src/orchestrator.js";
import type { WorkflowConfig } from "../src/config.js";

// ─── Helpers ────────────────────────────────────────────────────

let outputDir: string;

beforeEach(() => {
  outputDir = join(tmpdir(), `mw-test-orch-${Date.now()}`);
  mkdirSync(outputDir, { recursive: true });
});

const VALID_CONFIG: WorkflowConfig = {
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
  },
};

/** 创建一个根据传入参数动态返回结果的 mock StageRunner */
function createDynamicMock(success = true): StageRunner {
  return vi.fn().mockImplementation(async (params: {
    stage: string;
    config: any;
    context: string;
    modelRef: string;
    outputDir: string;
  }) => {
    const result: StageResult = {
      stage: params.stage,
      model: params.modelRef,
      status: success ? "success" : "failure",
      duration: 100,
      cost: 0.05,
      outputDir: params.outputDir,
      artifacts: success ? [`${params.stage}/design.md`] : [],
      error: success ? undefined : `阶段 "${params.stage}" 模拟错误`,
    };
    return result;
  });
}

// ─── Tests ───────────────────────────────────────────────────────

describe("runWorkflow", () => {
  it("按顺序执行所有 stage", async () => {
    const stageRunner = createDynamicMock(true);

    const report = await runWorkflow(
      {
        config: VALID_CONFIG,
        idea: "做一个番茄钟 CLI",
        outputDir,
      },
      stageRunner
    );

    expect(report.stages).toHaveLength(2);
    expect(report.stages[0].stage).toBe("brainstorming");
    expect(report.stages[1].stage).toBe("writing-plans");
    expect(report.status).toBe("success");
  });

  it("前一个 stage 失败且 onFailure=stop 时停止后续 stage", async () => {
    const stageRunner = createDynamicMock(false);

    const report = await runWorkflow(
      {
        config: VALID_CONFIG,
        idea: "test",
        outputDir,
      },
      stageRunner
    );

    expect(report.stages).toHaveLength(1);
    expect(report.stages[0].stage).toBe("brainstorming");
    expect(report.stages[0].status).toBe("failure");
    expect(report.status).toBe("failure");
  });

  it("stage 失败但 onFailure=continue 时继续后续 stage", async () => {
    const config: WorkflowConfig = {
      outputDir: "docs",
      stages: {
        brainstorming: {
          model: "x/y",
          onFailure: "continue",
        },
        "writing-plans": {
          model: "x/y",
          onFailure: "stop",
        },
      },
    };
    const stageRunner = vi.fn();
    stageRunner
      .mockResolvedValueOnce({
        stage: "brainstorming",
        model: "x/y",
        status: "failure",
        duration: 50,
        cost: 0,
        outputDir,
        artifacts: [],
        error: "模拟错误",
      })
      .mockResolvedValueOnce({
        stage: "writing-plans",
        model: "x/y",
        status: "success",
        duration: 100,
        cost: 0.05,
        outputDir,
        artifacts: [],
      });

    const report = await runWorkflow(
      { config, idea: "test", outputDir },
      stageRunner
    );

    expect(report.stages).toHaveLength(2);
    expect(report.stages[0].status).toBe("failure");
    expect(report.stages[1].status).toBe("success");
    expect(report.status).toBe("partial");
  });

  it("传递 context 到每个 stage", async () => {
    const stageRunner = vi.fn().mockImplementation(async (params) => ({
      stage: params.stage,
      model: params.modelRef,
      status: "success",
      duration: 100,
      cost: 0,
      outputDir: params.outputDir,
      artifacts: [`${params.stage}/design.md`],
    }));

    await runWorkflow(
      { config: VALID_CONFIG, idea: "做一个番茄钟", outputDir },
      stageRunner
    );

    // 第一个 stage 应该收到原始 idea
    expect(stageRunner).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        stage: "brainstorming",
        context: expect.stringContaining("番茄钟"),
      })
    );

    // 第二个 stage 应该收到 artifact 路径
    expect(stageRunner).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        stage: "writing-plans",
        context: expect.stringContaining("brainstorming"),
      })
    );
  });

  it("汇报正确的总结信息", async () => {
    const stageRunner = createDynamicMock(true);

    const report = await runWorkflow(
      { config: VALID_CONFIG, idea: "test", outputDir },
      stageRunner
    );

    expect(report.totalDuration).toBeGreaterThanOrEqual(0);
    expect(report.totalCost).toBeGreaterThanOrEqual(0);
    expect(report.stages).toHaveLength(2);
    expect(report.totalCost).toBeCloseTo(0.10, 5);
  });

  it("stage 失败且有 retry 时自动重试，成功即停止重试", async () => {
    const config: WorkflowConfig = {
      outputDir: "docs",
      stages: {
        brainstorming: {
          model: "x/y",
          retry: 2,
          onFailure: "stop",
        },
      },
    };
    const stageRunner = vi.fn();
    // 前2次失败，第3次成功
    stageRunner
      .mockResolvedValueOnce({
        stage: "brainstorming", model: "x/y", status: "failure",
        duration: 50, cost: 0, outputDir, artifacts: [], error: "网络超时",
      })
      .mockResolvedValueOnce({
        stage: "brainstorming", model: "x/y", status: "failure",
        duration: 50, cost: 0, outputDir, artifacts: [], error: "安装失败",
      })
      .mockResolvedValueOnce({
        stage: "brainstorming", model: "x/y", status: "success",
        duration: 100, cost: 0.05, outputDir, artifacts: ["design.md"],
      });

    const report = await runWorkflow(
      { config, idea: "test", outputDir },
      stageRunner
    );

    // 总共调了3次 (1次原始 + 2次重试)，第3次成功
    expect(stageRunner).toHaveBeenCalledTimes(3);
    expect(report.stages).toHaveLength(1);
    expect(report.stages[0].status).toBe("success");
    expect(report.status).toBe("success");
  });

  it("stage 失败超过 retry 次数后停止重试", async () => {
    const config: WorkflowConfig = {
      outputDir: "docs",
      stages: {
        brainstorming: {
          model: "x/y",
          retry: 1,
          onFailure: "stop",
        },
      },
    };
    const stageRunner = vi.fn();
    // 每次都失败
    stageRunner.mockResolvedValue({
      stage: "brainstorming", model: "x/y", status: "failure",
      duration: 50, cost: 0, outputDir, artifacts: [], error: "始终失败",
    });

    const report = await runWorkflow(
      { config, idea: "test", outputDir },
      stageRunner
    );

    // retry: 1 意味着最多 2 次尝试 (原始 + 1 次重试)
    expect(stageRunner).toHaveBeenCalledTimes(2);
    expect(report.stages).toHaveLength(1);
    expect(report.stages[0].status).toBe("failure");
    expect(report.status).toBe("failure");
  });
});
