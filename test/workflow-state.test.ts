import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  createState,
  markStageRunning,
  markStageComplete,
  findResumeStage,
  rebuildContext,
  loadState,
  saveState,
  getStatePath,
  type WorkflowState,
} from "../src/workflow-state.js";

// ─── Helper ────────────────────────────────────────────────────

let tempDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `mw-test-wfstate-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const STAGE_NAMES = ["brainstorming", "writing-plans", "executing-plans", "verification"];

// ─── createState ───────────────────────────────────────────────

describe("createState", () => {
  it("创建初始状态，所有阶段标记为 pending", () => {
    const state = createState("project-1", "做一个番茄钟", STAGE_NAMES);

    expect(state.projectName).toBe("project-1");
    expect(state.idea).toBe("做一个番茄钟");
    expect(state.completed).toBe(false);
    expect(state.createdAt).toBeDefined();
    expect(state.updatedAt).toBeDefined();
    expect(Object.keys(state.stages)).toEqual(STAGE_NAMES);
    for (const name of STAGE_NAMES) {
      expect(state.stages[name]).toEqual({ status: "pending", attempts: 0 });
    }
  });

  it("空的阶段列表也创建空的状态", () => {
    const state = createState("empty", "test", []);
    expect(Object.keys(state.stages)).toHaveLength(0);
  });
});

// ─── markStageRunning ──────────────────────────────────────────

describe("markStageRunning", () => {
  it("将阶段标记为 running 并递增 attempts", () => {
    const state = createState("p1", "test", STAGE_NAMES);
    markStageRunning(state, "brainstorming");

    expect(state.stages.brainstorming.status).toBe("running");
    expect(state.stages.brainstorming.attempts).toBe(1);
  });

  it("多次调用会递增 attempts", () => {
    const state = createState("p1", "test", STAGE_NAMES);
    markStageRunning(state, "brainstorming");
    markStageRunning(state, "brainstorming");
    markStageRunning(state, "brainstorming");

    expect(state.stages.brainstorming.attempts).toBe(3);
  });

  it("状态文件中不存在的阶段也会被创建", () => {
    const state = createState("p1", "test", []);
    markStageRunning(state, "custom-stage");

    expect(state.stages["custom-stage"].status).toBe("running");
    expect(state.stages["custom-stage"].attempts).toBe(1);
  });
});

// ─── markStageComplete ─────────────────────────────────────────

describe("markStageComplete", () => {
  it("标记阶段为 success 并记录耗时和成本", () => {
    const state = createState("p1", "test", STAGE_NAMES);
    markStageRunning(state, "brainstorming");

    markStageComplete(state, "brainstorming", {
      status: "success",
      duration: 45000,
      cost: 0.05,
      artifacts: ["brainstorming/design.md"],
    });

    expect(state.stages.brainstorming.status).toBe("success");
    expect(state.stages.brainstorming.attempts).toBe(1);
    expect(state.stages.brainstorming.duration).toBe(45000);
    expect(state.stages.brainstorming.cost).toBe(0.05);
    expect(state.stages.brainstorming.artifacts).toEqual(["brainstorming/design.md"]);
  });

  it("标记阶段为 failure 并记录错误信息", () => {
    const state = createState("p1", "test", STAGE_NAMES);
    markStageRunning(state, "executing-plans");

    markStageComplete(state, "executing-plans", {
      status: "failure",
      duration: 10000,
      cost: 0.01,
      artifacts: [],
      error: "npm install 失败",
    });

    expect(state.stages["executing-plans"].status).toBe("failure");
    expect(state.stages["executing-plans"].error).toBe("npm install 失败");
  });

  it("未调用 markStageRunning 也能标记完成", () => {
    const state = createState("p1", "test", STAGE_NAMES);
    markStageComplete(state, "brainstorming", {
      status: "success",
      duration: 100,
      cost: 0,
      artifacts: [],
    });

    expect(state.stages.brainstorming.status).toBe("success");
    expect(state.stages.brainstorming.attempts).toBe(1); // 兜底为 1
  });
});

// ─── findResumeStage ───────────────────────────────────────────

describe("findResumeStage", () => {
  it("所有阶段 pending 时返回第一个阶段", () => {
    const state = createState("p1", "test", STAGE_NAMES);
    expect(findResumeStage(state, STAGE_NAMES)).toBe("brainstorming");
  });

  it("前几个阶段完成后返回第一个未完成的阶段", () => {
    const state = createState("p1", "test", STAGE_NAMES);
    markStageComplete(state, "brainstorming", { status: "success", duration: 100, cost: 0, artifacts: [] });
    markStageComplete(state, "writing-plans", { status: "success", duration: 100, cost: 0, artifacts: [] });

    expect(findResumeStage(state, STAGE_NAMES)).toBe("executing-plans");
  });

  it("全部完成时返回 null", () => {
    const state = createState("p1", "test", STAGE_NAMES);
    for (const name of STAGE_NAMES) {
      markStageComplete(state, name, { status: "success", duration: 100, cost: 0, artifacts: [] });
    }

    expect(findResumeStage(state, STAGE_NAMES)).toBeNull();
  });

  it("中间阶段失败时返回该失败阶段（不是第一个 pending）", () => {
    const state = createState("p1", "test", STAGE_NAMES);
    markStageComplete(state, "brainstorming", { status: "success", duration: 100, cost: 0, artifacts: [] });
    markStageComplete(state, "writing-plans", { status: "failure", duration: 50, cost: 0, artifacts: [], error: "失败" });

    expect(findResumeStage(state, STAGE_NAMES)).toBe("writing-plans");
  });
});

// ─── rebuildContext ────────────────────────────────────────────

describe("rebuildContext", () => {
  it("没有已完成阶段时返回原始 idea", () => {
    const state = createState("p1", "测试项目", STAGE_NAMES);
    const ctx = rebuildContext(state, tempDir, STAGE_NAMES);
    expect(ctx).toBe("测试项目");
  });

  it("有已完成阶段时拼接上下文（含产物文件内容）", () => {
    const state = createState("p1", "测试项目", STAGE_NAMES);

    // 创建产物文件
    const bsDir = join(tempDir, "brainstorming");
    mkdirSync(bsDir, { recursive: true });
    writeFileSync(join(bsDir, "stage-brainstorming-output.md"), "设计方案：番茄钟 CLI");

    markStageComplete(state, "brainstorming", {
      status: "success", duration: 30000, cost: 0.02,
      artifacts: ["brainstorming/stage-brainstorming-output.md"],
    });

    const ctx = rebuildContext(state, tempDir, STAGE_NAMES);
    expect(ctx).toContain("设计方案：番茄钟 CLI");
    expect(ctx).toContain("brainstorming");
    expect(ctx).toContain("30.0s");
    expect(ctx).toContain("$0.0200");
  });

  it("产物文件不存在时仍能生成上下文（不含文件内容）", () => {
    const state = createState("p1", "idea", STAGE_NAMES);
    markStageComplete(state, "brainstorming", {
      status: "success", duration: 100, cost: 0,
      artifacts: ["brainstorming/design.md"],
    });

    const ctx = rebuildContext(state, tempDir, STAGE_NAMES);
    expect(ctx).toContain("brainstorming");
    expect(ctx).toContain("(无详细内容)"); // 文件不存在时的占位
  });
});

// ─── saveState / loadState 持久化 ──────────────────────────────

describe("saveState / loadState", () => {
  it("保存后能完整读取回来", () => {
    const state = createState("p1", "test", STAGE_NAMES);
    markStageComplete(state, "brainstorming", {
      status: "success", duration: 100, cost: 0.01, artifacts: [],
    });

    saveState(tempDir, state);
    expect(existsSync(getStatePath(tempDir))).toBe(true);

    const loaded = loadState(tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.projectName).toBe("p1");
    expect(loaded!.idea).toBe("test");
    expect(loaded!.stages.brainstorming.status).toBe("success");
    expect(loaded!.stages.brainstorming.duration).toBe(100);
    expect(loaded!.completed).toBe(false);
  });

  it("loadState 返回的对象的 updatedAt 是保存时的时间", () => {
    const state = createState("p1", "test", STAGE_NAMES);
    const before = Date.now();
    saveState(tempDir, state);
    const loaded = loadState(tempDir);
    const loadedTime = new Date(loaded!.updatedAt).getTime();
    expect(loadedTime).toBeGreaterThanOrEqual(before - 1000);
    expect(loadedTime).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("状态文件不存在时 loadState 返回 null", () => {
    const dir = join(tempDir, "nonexistent");
    expect(loadState(dir)).toBeNull();
  });

  it("状态文件损坏时 loadState 返回 null", () => {
    writeFileSync(getStatePath(tempDir), "{ invalid json }", "utf-8");
    expect(loadState(tempDir)).toBeNull();
  });
});

// ─── getStatePath ──────────────────────────────────────────────

describe("getStatePath", () => {
  it("返回正确的 .workflow-state.json 路径", () => {
    const path = getStatePath("output_projects" + sep + "myapp");
    const expected = "output_projects" + sep + "myapp" + sep + ".workflow-state.json";
    expect(path).toBe(expected);
  });
});

// ─── 完整流程集成 ──────────────────────────────────────────────

describe("工作流状态完整生命周期", () => {
  it("模拟一次完整的工作流运行过程", () => {
    // 创建初始状态
    const state = createState("project-1", "做一个番茄钟", STAGE_NAMES);
    expect(state.completed).toBe(false);
    expect(findResumeStage(state, STAGE_NAMES)).toBe("brainstorming");

    // 阶段 1: brainstorming 成功
    markStageRunning(state, "brainstorming");
    markStageComplete(state, "brainstorming", {
      status: "success", duration: 45000, cost: 0.05,
      artifacts: ["brainstorming/design.md"],
    });
    expect(findResumeStage(state, STAGE_NAMES)).toBe("writing-plans");

    // 阶段 2: writing-plans 成功
    markStageRunning(state, "writing-plans");
    markStageComplete(state, "writing-plans", {
      status: "success", duration: 30000, cost: 0.03,
      artifacts: ["writing-plans/plan.md"],
    });
    expect(findResumeStage(state, STAGE_NAMES)).toBe("executing-plans");

    // 阶段 3: executing-plans 失败一次后重试成功
    markStageRunning(state, "executing-plans");
    markStageComplete(state, "executing-plans", {
      status: "failure", duration: 10000, cost: 0.01,
      artifacts: [], error: "网络超时",
    });
    expect(state.stages["executing-plans"].attempts).toBe(1);
    expect(findResumeStage(state, STAGE_NAMES)).toBe("executing-plans"); // 仍返回失败的阶段

    // 重试成功
    markStageRunning(state, "executing-plans");
    expect(state.stages["executing-plans"].attempts).toBe(2);
    markStageComplete(state, "executing-plans", {
      status: "success", duration: 60000, cost: 0.08,
      artifacts: ["executing-plans/code.md"],
    });
    expect(findResumeStage(state, STAGE_NAMES)).toBe("verification");

    // 阶段 4: verification 成功
    markStageRunning(state, "verification");
    markStageComplete(state, "verification", {
      status: "success", duration: 20000, cost: 0.02,
      artifacts: ["verification/report.md"],
    });

    // 全部完成
    state.completed = true;
    expect(findResumeStage(state, STAGE_NAMES)).toBeNull();

    // 验证总耗时和总成本
    const totalDuration = Object.values(state.stages).reduce((sum, s) => sum + (s.duration || 0), 0);
    const totalCost = Object.values(state.stages).reduce((sum, s) => sum + (s.cost || 0), 0);
    expect(totalDuration).toBe(45000 + 30000 + 60000 + 20000);
    expect(totalCost).toBeCloseTo(0.05 + 0.03 + 0.08 + 0.02);
  });
});
