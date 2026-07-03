import { readFile } from "node:fs/promises";

/** 每个阶段的失败处理策略 */
export type FailureStrategy = "stop" | "continue";

/** 思考模式 */
export type ThinkingLevel = "off" | "low" | "medium" | "high" | "xhigh";

/** E2E 视觉验证配置 */
export interface E2EConfig {
  /** 启动 dev server 的命令, 如 "npm run dev" */
  devCommand: string;
  /** 应用的基础 URL, 如 "http://localhost:5173" */
  baseUrl: string;
  /** 需要截图的页面路径列表, 如 ["/", "/about"] */
  paths: string[];
  /** 视口尺寸, 默认 1280x720 */
  viewport?: { width: number; height: number };
  /** 页面加载后等待的毫秒数, 默认 2000 */
  waitMs?: number;
}

/** 单个阶段的配置 */
export interface StageConfig {
  model: string;
  label?: string;
  thinking?: ThinkingLevel;
  skill?: string;
  onFailure?: FailureStrategy;
  /** E2E 视觉验证配置 (仅 verification 阶段有效) */
  e2e?: E2EConfig;
}

/** 完整的工作流配置 */
export interface WorkflowConfig {
  outputDir: string;
  stages: Record<string, StageConfig>;
}

/**
 * 从 JSON 文件加载工作流配置。
 * @param path 配置文件路径
 */
export async function loadConfig(path: string): Promise<WorkflowConfig> {
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw);
  return validateConfig(parsed);
}

/**
 * 校验配置对象的合法性。
 * @param raw 待校验的配置
 */
export function validateConfig(raw: unknown): WorkflowConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("配置必须是有效的 JSON 对象");
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.outputDir !== "string" || obj.outputDir === "") {
    throw new Error("outputDir 必须是非空字符串");
  }

  if (!obj.stages || typeof obj.stages !== "object" || Object.keys(obj.stages as Record<string, unknown>).length === 0) {
    throw new Error("stages 至少需要定义一个阶段");
  }

  const stages = obj.stages as Record<string, unknown>;
  const validatedStages: Record<string, StageConfig> = {};

  for (const [name, stageRaw] of Object.entries(stages)) {
    if (typeof stageRaw !== "object" || stageRaw === null) {
      throw new Error(`阶段 "${name}" 的配置无效`);
    }

    const s = stageRaw as Record<string, unknown>;

    if (typeof s.model !== "string" || s.model === "") {
      throw new Error(`阶段 "${name}" 缺少 model 或 model 为空`);
    }

    validatedStages[name] = {
      model: s.model,
      label: typeof s.label === "string" ? s.label : undefined,
      thinking: validateThinkingLevel(s.thinking),
      skill: typeof s.skill === "string" ? s.skill : undefined,
      onFailure: validateFailureStrategy(s.onFailure),
      e2e: validateE2EConfig(s.e2e),
    };
  }

  return {
    outputDir: obj.outputDir,
    stages: validatedStages,
  };
}

function validateThinkingLevel(val: unknown): ThinkingLevel | undefined {
  const VALID = new Set(["off", "low", "medium", "high", "xhigh"]);
  if (val === undefined || val === null) return undefined;
  if (typeof val === "string" && VALID.has(val)) return val as ThinkingLevel;
  throw new Error(`thinking 必须是 off/low/medium/high/xhigh 之一，收到: ${val}`);
}

function validateE2EConfig(val: unknown): E2EConfig | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val !== "object" || val === null) {
    throw new Error("e2e 配置必须是对象");
  }
  const e = val as Record<string, unknown>;
  if (typeof e.devCommand !== "string" || !e.devCommand) {
    throw new Error("e2e.devCommand 必须是非空字符串");
  }
  if (typeof e.baseUrl !== "string" || !e.baseUrl) {
    throw new Error("e2e.baseUrl 必须是非空字符串");
  }
  if (!Array.isArray(e.paths) || e.paths.length === 0) {
    throw new Error("e2e.paths 必须是非空数组");
  }
  return {
    devCommand: e.devCommand,
    baseUrl: e.baseUrl,
    paths: e.paths.map(String),
    viewport: e.viewport && typeof e.viewport === "object"
      ? { width: Number((e.viewport as any).width) || 1280, height: Number((e.viewport as any).height) || 720 }
      : undefined,
    waitMs: typeof e.waitMs === "number" ? e.waitMs : 2000,
  };
}

function validateFailureStrategy(val: unknown): FailureStrategy | undefined {
  const VALID = new Set(["stop", "continue"]);
  if (val === undefined || val === null) return undefined;
  if (typeof val === "string" && VALID.has(val)) return val as FailureStrategy;
  throw new Error(`onFailure 必须是 stop/continue 之一，收到: ${val}`);
}
