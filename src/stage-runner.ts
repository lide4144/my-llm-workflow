import type { StageConfig } from "./config.js";
import { saveArtifact, listArtifacts } from "./artifact-store.js";

/** 单阶段执行结果 */
export interface StageResult {
  stage: string;
  model: string;
  status: "success" | "failure" | "skipped";
  duration: number;
  cost: number;
  outputDir: string;
  artifacts: string[];
  error?: string;
}

/** 阶段执行参数 */
export interface StageRunnerOptions {
  stage: string;
  config: StageConfig;
  context: string;
  modelRef: string;
  outputDir: string;
  onOutput?: (text: string) => void;
}

/** Agent 会话接口 */
export interface AgentSession {
  prompt(text: string): Promise<void>;
  subscribe(fn: (event: unknown) => void): () => void;
  dispose(): void;
}

/**
 * Agent 工厂 — 创建可执行 prompt 的 agent session。
 * 生产环境使用 pi SDK，测试时可注入 mock。
 */
export interface AgentFactory {
  createSession(options: {
    modelRef: string;
    thinking?: string;
  }): Promise<AgentSession>;
}

/**
 * 执行单个工作流阶段。
 *
 * @param options 阶段参数
 * @param agentFactory 可选，注入 agent 工厂（默认使用 pi SDK）
 */
export async function runStage(
  options: StageRunnerOptions,
  agentFactory?: AgentFactory
): Promise<StageResult> {
  const startTime = Date.now();
  const artifacts: string[] = [];
  let cost = 0;

  // 没有注入 factory 时报错（生产环境需要由 orchestrator 提供）
  if (!agentFactory) {
    throw new Error(
      "runStage 需要注入 AgentFactory。" +
      "生产环境请使用 createPiAgentFactory() 创建。"
    );
  }

  // 1. 创建 session
  const session = await agentFactory.createSession({
    modelRef: options.modelRef,
    thinking: options.config.thinking,
  });

  try {
    // 2. 订阅输出事件
    const unsubscribe = session.subscribe((event: any) => {
      if (
        event?.type === "message_update" &&
        event?.assistantMessageEvent?.type === "text_delta"
      ) {
        options.onOutput?.(event.assistantMessageEvent.delta);
      }
    });

    // 3. 构建 prompt 并执行
    const promptText = buildStagePrompt(options.stage, options.config, options.context);
    await session.prompt(promptText);

    unsubscribe();

    // 4. 保存产物 — 将 context 中的 idea 存为设计文档雏形
    //    真实的 agent 输出会在后续阶段通过文件传递
    const artifactMeta = await saveArtifact({
      outputDir: options.outputDir,
      stage: options.stage,
      fileName: `stage-${options.stage}-output.md`,
      content: `# ${options.stage} 阶段输出\n\n模型: ${options.modelRef}\n\n## 上下文\n\n${options.context}\n`,
    });
    artifacts.push(artifactMeta.path);

    const duration = Date.now() - startTime;

    return {
      stage: options.stage,
      model: options.modelRef,
      status: "success",
      duration,
      cost,
      outputDir: options.outputDir,
      artifacts,
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    return {
      stage: options.stage,
      model: options.modelRef,
      status: "failure",
      duration,
      cost,
      outputDir: options.outputDir,
      artifacts,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    session.dispose();
  }
}

function buildStagePrompt(
  stage: string,
  config: StageConfig,
  context: string
): string {
  const skillHint = config.skill
    ? `\n\n请使用 "${config.skill}" 技能来完成此阶段的工作。`
    : "";

  return [
    `## 工作流阶段: ${stage}${config.label ? ` (${config.label})` : ""}`,
    ``,
    `模型: ${config.model}`,
    skillHint,
    ``,
    `## 上下文`,
    ``,
    context,
    ``,
    `请根据以上上下文完成 "${stage}" 阶段的工作。`,
  ].join("\n");
}
