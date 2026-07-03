import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowConfig, StageConfig } from "./config.js";

/** Stage runner 返回的原始结果 */
export interface StageResult {
  stage: string;
  model: string;
  status: "success" | "failure" | "skipped";
  duration: number;
  cost: number;
  artifacts: string[];
  error?: string;
}

/** 带配置信息的 stage 记录 */
export interface StageRecord extends StageResult {
  config: StageConfig;
}

/** 工作流整体报告 */
export interface WorkflowReport {
  status: "success" | "failure" | "partial";
  totalDuration: number;
  totalCost: number;
  stages: StageRecord[];
}

/** 工作流执行参数 */
export interface WorkflowOptions {
  config: WorkflowConfig;
  idea: string;
  outputDir: string;
  from?: string;
  to?: string;
  onStageStart?: (stage: string) => void;
  onStageComplete?: (record: StageRecord) => void;
}

/**
 * StageRunner 签名 — 注入 mock 或真实执行器。
 */
export type StageRunner = (params: {
  stage: string;
  config: StageConfig;
  context: string;
  modelRef: string;
  outputDir: string;
  onOutput?: (text: string) => void;
}) => Promise<StageResult>;

/**
 * 运行完整工作流。
 */
export async function runWorkflow(
  options: WorkflowOptions,
  stageRunner?: StageRunner
): Promise<WorkflowReport> {
  const { config, idea, outputDir } = options;

  if (!stageRunner) {
    throw new Error(
      "runWorkflow 需要注入 StageRunner。" +
      "生产环境请使用 createWorkflowStageRunner() 创建。"
    );
  }

  // 确定 stage 执行范围
  const stageNames = Object.keys(config.stages);
  let startIndex = 0;
  let endIndex = stageNames.length - 1;

  if (options.from) {
    const idx = stageNames.indexOf(options.from);
    if (idx >= 0) startIndex = idx;
  }
  if (options.to) {
    const idx = stageNames.indexOf(options.to);
    if (idx >= 0) endIndex = idx;
  }

  const orderedStages = stageNames.slice(startIndex, endIndex + 1);
  const records: StageRecord[] = [];
  let context = idea;
  let hasFailure = false;

  const startTime = Date.now();

  for (const name of orderedStages) {
    const stageConfig = config.stages[name];

    options.onStageStart?.(name);

    const result = await stageRunner({
      stage: name,
      config: stageConfig,
      context,
      modelRef: stageConfig.model,
      outputDir,
    });

    const record: StageRecord = {
      ...result,
      config: stageConfig,
    };
    records.push(record);

    // 更新 context — 包含上一阶段的完整产出内容
    if (result.artifacts.length > 0) {
      const stageDir = join(outputDir, name);
      let stageContent = "";
      try {
        const outFile = join(stageDir, "stage-" + name + "-output.md");
        if (existsSync(outFile)) {
          stageContent = readFileSync(outFile, "utf-8").slice(0, 4000);
        }
      } catch {}

      context = '上一阶段 "' + name + '" 已完成 (' + (result.duration / 1000).toFixed(1) + 's, $' + result.cost.toFixed(4) + ').\n\n### 上一阶段产出内容:\n\n' + (stageContent || "(无详细内容)") + '\n\n### 产出物文件:\n' + result.artifacts.map(function(a) { return "- " + a; }).join("\n") + '\n\n请基于以上信息继续当前阶段的工作。';
    }

    options.onStageComplete?.(record);

    // 失败处理
    if (result.status === "failure") {
      hasFailure = true;
      if (stageConfig.onFailure === "stop") {
        break;
      }
      // onFailure === "continue" → 继续
    }
  }

  const totalDuration = Date.now() - startTime;
  const totalCost = records.reduce((sum, r) => sum + r.cost, 0);

  // 整体状态
  const overallStatus: WorkflowReport["status"] = hasFailure
    ? records.some((r) => r.status === "success")
      ? "partial"
      : "failure"
    : "success";

  return {
    status: overallStatus,
    totalDuration,
    totalCost,
    stages: records,
  };
}
