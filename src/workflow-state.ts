/**
 * 工作流状态持久化 — 支持 --continue 从中断处恢复。
 *
 * 状态文件保存在 <projectDir>/.workflow-state.json
 * 每次阶段完成后更新，确保中断后可恢复。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** 单个阶段的持久化状态 */
export interface StageState {
  status: "pending" | "running" | "success" | "failure";
  attempts: number;
  duration?: number;
  cost?: number;
  artifacts?: string[];
  error?: string;
}

/** 完整的工作流持久化状态 */
export interface WorkflowState {
  projectName: string;
  idea: string;
  createdAt: string;
  updatedAt: string;
  completed: boolean;
  stages: Record<string, StageState>;
}

/** 状态文件路径 */
export function getStatePath(projectDir: string): string {
  return join(projectDir, ".workflow-state.json");
}

/** 从文件加载状态，不存在时返回 null */
export function loadState(projectDir: string): WorkflowState | null {
  const path = getStatePath(projectDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** 保存状态到文件 */
export function saveState(projectDir: string, state: WorkflowState): void {
  state.updatedAt = new Date().toISOString();
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(getStatePath(projectDir), JSON.stringify(state, null, 2), "utf-8");
}

/** 创建初始状态（所有阶段标记为 pending） */
export function createState(
  projectName: string,
  idea: string,
  stageNames: string[]
): WorkflowState {
  const stages: Record<string, StageState> = {};
  for (const name of stageNames) {
    stages[name] = { status: "pending", attempts: 0 };
  }
  return {
    projectName,
    idea,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completed: false,
    stages,
  };
}

/** 标记某个阶段开始执行 */
export function markStageRunning(state: WorkflowState, stage: string): void {
  if (!state.stages[stage]) {
    state.stages[stage] = { status: "running", attempts: 0 };
  }
  state.stages[stage].status = "running";
  state.stages[stage].attempts = (state.stages[stage].attempts || 0) + 1;
}

/** 标记某个阶段完成 */
export function markStageComplete(
  state: WorkflowState,
  stage: string,
  result: { status: "success" | "failure"; duration: number; cost: number; artifacts: string[]; error?: string }
): void {
  state.stages[stage] = {
    status: result.status,
    attempts: state.stages[stage]?.attempts || 1,
    duration: result.duration,
    cost: result.cost,
    artifacts: result.artifacts,
    error: result.error,
  };
}

/** 查找第一个未完成的阶段（用于 --continue） */
export function findResumeStage(state: WorkflowState, stageNames: string[]): string | null {
  for (const name of stageNames) {
    const s = state.stages[name];
    if (!s || s.status !== "success") {
      return name;
    }
  }
  // 全部完成
  return null;
}

/**
 * 从已完成阶段的产物文件中重建 context。
 * 这样恢复时 agent 能知道之前各阶段做了什么。
 */
export function rebuildContext(
  state: WorkflowState,
  outputDir: string,
  stageNames: string[]
): string {
  const completedNames = stageNames.filter(
    (name) => state.stages[name]?.status === "success"
  );

  if (completedNames.length === 0) {
    return state.idea;
  }

  const parts: string[] = [];
  for (const name of completedNames) {
    const s = state.stages[name];
    // 尝试读取产物文件内容
    let stageContent = "";
    try {
      const outFile = join(outputDir, name, "stage-" + name + "-output.md");
      if (existsSync(outFile)) {
        stageContent = readFileSync(outFile, "utf-8").slice(0, 4000);
      }
    } catch {}

    parts.push(
      `上一阶段 "${name}" 已完成 (${((s.duration || 0) / 1000).toFixed(1)}s, $${(s.cost || 0).toFixed(4)}).\n` +
      `### 上一阶段产出内容:\n\n` +
      (stageContent || "(无详细内容)") +
      `\n\n### 产出物文件:\n` +
      (s.artifacts || []).map((a) => "- " + a).join("\n")
    );
  }

  return parts.join("\n\n");
}
