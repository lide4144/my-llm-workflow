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

import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { loadConfig, type WorkflowConfig } from "./config.js";
import { runWorkflow, type StageRunner, type StageResult } from "./orchestrator.js";
import { createPiAgentFactory } from "./pi-agent-factory.js";
import { saveArtifact } from "./artifact-store.js";
import { runSetupWizard } from "./config-wizard.js";
import * as readline from "node:readline/promises";
import { stdin as rlInput, stdout as rlOutput } from "node:process";
import type { ImageInput } from "./stage-runner.js";

// ─── 简易命令行解析（无需外部依赖） ─────────────────────────────

function parseArgs(args: string[]): {
  config: string;
  idea: string;
  from?: string;
  to?: string;
  overrides: Record<string, string>;
  images: string[];
  setup?: boolean;
} {
  let config = "workflow.config.json";
  let from: string | undefined;
  let to: string | undefined;
  let setup = false;
  const overrides: Record<string, string> = {};
  const images: string[] = [];
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--setup" || arg === "-s") {
      setup = true;
    } else if (arg === "--config" || arg === "-c") {
      config = args[++i];
    } else if (arg === "--image" || arg === "-i") {
      images.push(args[++i]);
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

  return { config, idea: positional.join(" ").trim(), from, to, overrides, images, setup };
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

  if (args.setup) {
    await runSetupWizard();
    return;
  }

  if (!args.idea) {
    log(`${C.yellow}用法: npm start -- [选项] "项目描述"${C.reset}`);
    log(`   --setup, -s            交互式模型配置向导`);
    log(`   --config, -c <path>    配置文件路径 (默认: workflow.config.json)`);
    log(`   --image, -i <path>     附加图片 (可重复使用)`);
    log(`   --from <stage>         起始阶段`);
    log(`   --to <stage>           结束阶段`);
    log(`   --override, -o <s:m>   覆盖某阶段的模型, 如 "brainstorming:claude-sonnet"`);
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

  // 3. 加载图片
  const loadedImages: ImageInput[] = [];
  const MEDIA_TYPES: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
  };

  for (const imgPath of args.images) {
    if (!existsSync(imgPath)) {
      log(`  ${C.yellow}⚠ 图片文件不存在: ${imgPath}${C.reset}`);
      continue;
    }
    const ext = extname(imgPath).toLowerCase();
    const mediaType = MEDIA_TYPES[ext];
    if (!mediaType) {
      log(`  ${C.yellow}⚠ 不支持的图片格式: ${imgPath} (支持: png, jpg, webp, gif, bmp)${C.reset}`);
      continue;
    }
    const data = readFileSync(imgPath).toString("base64");
    loadedImages.push({ path: imgPath, mediaType, base64: data });
    log(`  ${C.dim}📷 已加载图片: ${imgPath} (${mediaType})${C.reset}`);
  }

  // 4. 创建生产 AgentFactory 和 StageRunner
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

    const promptLines = [
      `## 工作流阶段: ${params.stage}${params.config.label ? ` (${params.config.label})` : ""}`,
      ``,
      `模型: ${params.modelRef}`,
      params.config.skill ? `\n请使用 "${params.config.skill}" 技能来完成此阶段的工作。\n` : "",
      ``,
      `## 上下文`,
      ``,
      params.context,
    ];

    // E2E 视觉验证 — 按阶段注入不同指引
    // 配置取自 verification 阶段的 e2e 字段, 影响全部阶段
    const e2eCfg = config.stages.verification?.e2e;
    const screenshotScript = resolve(import.meta.dirname!, "e2e-screenshot.mjs");
    const vp = e2eCfg?.viewport ? `${e2eCfg.viewport.width}x${e2eCfg.viewport.height}` : "1280x720";

    if (e2eCfg && params.stage === "brainstorming") {
      promptLines.push(
        ``,
        `## 前端页面测试策略`,
        ``,
        `本项目包含前端页面, 请在设计中考虑 E2E 测试需求。`,
        `后续阶段会基于你的设计编写 Playwright 测试并截图验证。`,
        `在方案中注明哪些功能点需要截图验证。`
      );

    } else if (e2eCfg && params.stage === "writing-plans") {
      promptLines.push(
        ``,
        `## E2E 测试设计`,
        ``,
        `本项目包含前端页面, 请设计端到端 (E2E) 测试策略。`,
        ``,
        `### 基础设施`,
        `- Dev server: \`${e2eCfg.devCommand}\` 启动在 ${e2eCfg.baseUrl}`,
        `- 视口: ${vp}`,
        ``,
        `### 要求`,
        `1. 设计 3-5 个核心用户场景（如: 访问首页 → 导航 → 交互 → 验证）`,
        `2. 对每个场景指定:`,
        `   - 测试步骤（用户操作序列）`,
        `   - 预期结果（页面内容、URL、UI 状态）`,
        `   - 视觉检查点（需要截图验证的关键元素）`,
        `3. 在计划文档中列出这些场景`,
        `4. 实施阶段会根据你的设计编写 Playwright 测试脚本`
      );

    } else if (e2eCfg && params.stage === "executing-plans") {
      promptLines.push(
        ``,
        `## E2E 测试实现`,
        ``,
        `请根据上一阶段设计的 E2E 场景, 用 Playwright 编写自动化测试。`,
        ``,
        `### 要求`,
        `1. 安装 Playwright: \`npm install --save-dev playwright\``,
        `2. 创建 tests/e2e/ 目录和测试文件`,
        `3. 每个场景一个测试, 包含:`,
        `   - 页面导航操作`,
        `   - 用户交互`,
        `   - 截图: \`await page.screenshot({ path: \`screenshots/<场景名>.png\` })\``,
        `   - 断言 (URL、文本、元素可见性)`,
        `4. 确保测试可独立运行: \`npx playwright test tests/e2e/\``,
        `5. 提交后 verification 阶段会自动执行这些测试并查看截图`,
        ``,
        `### 基础设施`,
        `- Dev server: \`${e2eCfg.devCommand}\` 启动在 ${e2eCfg.baseUrl}`,
        `- 视口: ${vp}`
      );

    } else if (e2eCfg && params.stage === "verification") {
      promptLines.push(
        ``,
        `## E2E 视觉验证`,
        ``,
        `你需要执行前序阶段设计的 E2E 测试, 并通过截图验证页面渲染。`,
        ``,
        `### 步骤`,
        `1. 启动 dev server: \`${e2eCfg.devCommand}\``,
        `2. 运行 E2E 测试: \`npx playwright test tests/e2e/\``,
        `   - 如果 tests/e2e/ 不存在, 用截图工具手动截图:`,
        `     node "${screenshotScript}" --base-url ${e2eCfg.baseUrl} --paths / --viewport ${vp}`,
        `3. 用 read 工具查看每张截图, 检查:`,
        `   - 页面是否为完全空白 (白屏)`,
        `   - 是否有渲染错误或控制台报错`,
        `   - 布局是否正常, 关键 UI 元素是否可见`,
        `4. 如果有页面异常, 分析原因并修复`,
        `5. 修复后重新截图验证`,
        ``,
        `重要: 你必须\`亲眼\`看截图来验证, 不能只依赖状态码。`,
        `前端渲染错误经常返回 200 但页面空白。`
      );
    }

    const promptText = promptLines.join("\n");

    try {
      const hasImages = loadedImages.length > 0 && params.stage === Object.keys(config.stages)[0];

      if (params.config.interactive) {
        let turn = 0;
        let currentPrompt = promptText;
        const maxTurns = 10;
        let passImages = hasImages;

        while (turn < maxTurns) {
          await session.prompt(currentPrompt, passImages ? { images: loadedImages } : undefined);
          turn++;
          passImages = false;

          const lastLine = output.trim().split("\n").pop()?.trim() ?? "";
          const waiting = /[?？]$/.test(lastLine) ||
            /请选择|请回答|Which approach|选择|回车/.test(lastLine);
          if (!waiting || turn >= maxTurns) break;

          const rl = readline.createInterface({ input: rlInput, output: rlOutput });
          const answer = await rl.question("\n  " + C.cyan + "\u270e 你的回答" + C.reset + " (直接回车结束本轮): ");
          rl.close();
          if (!answer.trim()) break;
          currentPrompt = answer;
        }
      } else {
        await session.prompt(promptText, hasImages ? { images: loadedImages } : undefined);
      }

      const artifactMeta = await saveArtifact({
        outputDir: params.outputDir,
        stage: params.stage,
        fileName: "stage-" + params.stage + "-output.md",
        content: output || "# " + params.stage + "\n\n(无文本输出)\n",
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
