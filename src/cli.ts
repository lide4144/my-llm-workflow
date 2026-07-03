#!/usr/bin/env tsx
/**
 * my-llm-workflow CLI 入口
 *
 * 用法:
 *   npm start -- "做一个番茄钟 CLI 工具"
 *   npx tsx src/cli.ts "做一个番茄钟 CLI 工具"
 *   node src/cli.mjs --config path/to/config.json "项目想法"
 *   node src/cli.mjs --from writing-plans "只从计划阶段开始"
 *   node src/cli.mjs --override executing-plans:claude-sonnet "覆盖模型的执行阶段"
 */

import { readFileSync, existsSync } from "node:fs";
import { loadConfig, type WorkflowConfig } from "./config.js";
import { runWorkflow, type StageRunner, type StageResult } from "./orchestrator.js";
import { createPiAgentFactory } from "./pi-agent-factory.js";
import { saveArtifact } from "./artifact-store.js";

// ─── 简易命令行解析（无需外部依赖） ─────────────────────────────

function parseArgs(args: string[]): {
  config: string;
  idea: string;
  from?: string;
  to?: string;
  overrides: Record<string, string>;
} {
  let config = "workflow.config.json";
  let from: string | undefined;
  let to: string | undefined;
  const overrides: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--config" || arg === "-c") {
      config = args[++i];
    } else if (arg === "--from") {
      from = args[++i];
    } else if (arg === "--to") {
      to = args[++i];
    } else if (arg === "--override" || arg === "-o") {
      const val = args[++i];
      const colonIdx = val.indexOf(":");
      if (colonIdx > 0) {
        overrides[val.slice(0, colonIdx)] = val.slice(colonIdx + 1);
      }
    } else if (arg.startsWith("--")) {
      // skip unknown flags
    } else {
      positional.push(arg);
    }
  }

  return { config, idea: positional.join(" ").trim(), from, to, overrides };
}

// ─── 彩色的 log ─────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

function log(...msg: string[]) {
  console.log(...msg);
}

function logStage(name: string, index: number, total: number, config: { model: string; label?: string }) {
  log(`\n${C.bold}${C.cyan}▶ [${index + 1}/${total}] ${name}${C.reset}`);
  if (config.label) log(`  ${C.dim}${config.label}${C.reset}`);
  log(`  ${C.dim}模型: ${config.model}${C.reset}`);
}

function logStageResult(result: StageResult, index: number) {
  const icon = result.status === "success" ? "✓" : result.status === "failure" ? "✗" : "−";
  const color = result.status === "success" ? C.green : C.red;
  const time = `${(result.duration / 1000).toFixed(1)}s`;
  const cost = result.cost > 0 ? `, 成本: $${result.cost.toFixed(4)}` : "";
  log(`  ${color}${icon} ${result.stage}${C.reset} ${C.dim}(${time}${cost})${C.reset}`);
  if (result.error) {
    log(`    ${C.red}错误: ${result.error}${C.reset}`);
  }
  if (result.artifacts.length > 0) {
    for (const a of result.artifacts) {
      log(`    ${C.dim}产出: ${a}${C.reset}`);
    }
  }
}

// ─── 主流程 ─────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.idea) {
    log(`${C.yellow}用法: node src/cli.mjs [选项] "项目描述"${C.reset}`);
    log(`   --config, -c <path>   配置文件路径 (默认: workflow.config.json)`);
    log(`   --from <stage>        起始阶段`);
    log(`   --to <stage>          结束阶段`);
    log(`   --override, -o <s:m>  覆盖某阶段的模型, 如 "brainstorming:claude-sonnet"`);
    process.exit(1);
  }

  // 1. 加载配置
  if (!existsSync(args.config)) {
    log(`${C.red}找不到配置文件: ${args.config}${C.reset}`);
    log(`请在当前目录创建 workflow.config.json，或使用 --config 指定路径。`);
    process.exit(1);
  }
  const config = await loadConfig(args.config);

  // 2. 应用 overrides
  if (Object.keys(args.overrides).length > 0) {
    for (const [stage, model] of Object.entries(args.overrides)) {
      if (config.stages[stage]) {
        config.stages[stage].model = model;
        log(`${C.dim}  覆写 ${stage} 模型为: ${model}${C.reset}`);
      }
    }
  }

  // 3. 创建生产 AgentFactory 和 StageRunner
  const agentFactory = createPiAgentFactory();

  const stageRunner: StageRunner = async (params) => {
    const startTime = Date.now();
    const session = await agentFactory.createSession({
      modelRef: params.modelRef,
      thinking: params.config.thinking,
    });

    let output = "";
    let cost = 0;

    session.subscribe((event: any) => {
      if (
        event?.type === "message_update" &&
        event?.assistantMessageEvent?.type === "text_delta"
      ) {
        const delta = event.assistantMessageEvent.delta ?? "";
        output += delta;
        params.onOutput?.(delta);
      }
      if (
        event?.type === "message_end" &&
        event?.message?.role === "assistant" &&
        event?.message?.usage?.cost?.total
      ) {
        cost += event.message.usage.cost.total;
      }
    });

    const promptText = [
      `## 工作流阶段: ${params.stage}${params.config.label ? ` (${params.config.label})` : ""}`,
      ``,
      `模型: ${params.modelRef}`,
      params.config.skill ? `\n请使用 "${params.config.skill}" 技能来完成此阶段的工作。\n` : "",
      ``,
      `## 上下文`,
      ``,
      params.context,
    ].join("\n");

    try {
      await session.prompt(promptText);

      // 保存 LLM 输出为产物
      const artifactMeta = await saveArtifact({
        outputDir: params.outputDir,
        stage: params.stage,
        fileName: `stage-${params.stage}-output.md`,
        content: output || `# ${params.stage}\n\n(无文本输出)\n`,
      });

      return {
        stage: params.stage,
        model: params.modelRef,
        status: "success",
        duration: Date.now() - startTime,
        cost,
        outputDir: params.outputDir,
        artifacts: [artifactMeta.path],
      };
    } catch (err) {
      return {
        stage: params.stage,
        model: params.modelRef,
        status: "failure",
        duration: Date.now() - startTime,
        cost,
        outputDir: params.outputDir,
        artifacts: [],
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      session.dispose();
    }
  };

  // 4. 执行工作流
  const stageNames = Object.keys(config.stages);
  log(`${C.bold}🚀 my-llm-workflow${C.reset}`);
  log(`${C.dim}   ${stageNames.length} 个阶段 | 配置: ${args.config}${C.reset}`);
  log(`${C.dim}   ${"-".repeat(40)}${C.reset}`);

  const report = await runWorkflow(
    {
      config,
      idea: args.idea,
      outputDir: config.outputDir,
      from: args.from,
      to: args.to,
      onStageStart: (stage) => {
        const idx = stageNames.indexOf(stage);
        logStage(stage, idx, stageNames.length, config.stages[stage]);
      },
      onStageComplete: (record) => {
        logStageResult(record, stageNames.indexOf(record.stage));
      },
    },
    stageRunner
  );

  // 5. 总结
  const statusColor = report.status === "success" ? C.green : report.status === "partial" ? C.yellow : C.red;
  const statusIcon = report.status === "success" ? "✅" : report.status === "partial" ? "⚠️" : "❌";

  log(`\n${C.bold}${statusColor}${statusIcon} 工作流完成: ${report.status}${C.reset}`);
  log(`  ${C.dim}总耗时: ${(report.totalDuration / 1000).toFixed(1)}s  | 总成本: $${report.totalCost.toFixed(4)}${C.reset}`);

  // 列出所有产物
  const allArtifacts = report.stages.flatMap((r) => r.artifacts);
  if (allArtifacts.length > 0) {
    log(`\n  产出物:`);
    for (const a of allArtifacts) {
      log(`    ${C.dim}• ${a}${C.reset}`);
    }
  }
}

main().catch((err) => {
  console.error(`\x1b[31m错误: ${err.message}\x1b[0m`);
  process.exit(1);
});
