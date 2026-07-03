#!/usr/bin/env tsx
/**
 * my-llm-workflow CLI 入口
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { loadConfig, type WorkflowConfig } from "./config.js";
import { runWorkflow, type StageRunner, type StageResult } from "./orchestrator.js";
import { createPiAgentFactory } from "./pi-agent-factory.js";
import { saveArtifact } from "./artifact-store.js";
import { runSetupWizard } from "./config-wizard.js";
import * as readline from "node:readline/promises";
import { stdin as rlInput, stdout as rlOutput } from "node:process";
import type { ImageInput } from "./stage-runner.js";

// ─── 参数解析 ───────────────────────────────────────────────

function parseArgs(args: string[]) {
  let config = "workflow.config.json";
  let from: string | undefined;
  let to: string | undefined;
  let setup = false;
  let project: string | undefined;
  let answers: string | undefined;
  const overrides: Record<string, string> = {};
  const images: string[] = [];
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--setup" || arg === "-s") {
      setup = true;
    } else if (arg === "--project" || arg === "-p") {
      project = args[++i];
    } else if (arg === "--answers" || arg === "-a") {
      answers = args[++i];
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
      // skip unknown
    } else {
      positional.push(arg);
    }
  }

  return {
    config,
    idea: positional.join(" ").trim(),
    from, to, overrides, images, project, answers, setup,
  };
}

// ─── 彩色 log ───────────────────────────────────────────────

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

function logStage(name: string, idx: number, total: number, cfg: { model: string; label?: string }) {
  log(`\n${C.bold}${C.cyan}> [${idx + 1}/${total}] ${name}${C.reset}`);
  if (cfg.label) log(`  ${C.dim}${cfg.label}${C.reset}`);
  log(`  ${C.dim}模型: ${cfg.model}${C.reset}`);
}

function logStageResult(r: StageResult) {
  const icon = r.status === "success" ? "OK" : r.status === "failure" ? "FAIL" : "--";
  const color = r.status === "success" ? C.green : C.red;
  const time = `${(r.duration / 1000).toFixed(1)}s`;
  const cost = r.cost > 0 ? `, 成本: $${r.cost.toFixed(4)}` : "";
  log(`  ${color}${icon} ${r.stage}${C.reset} ${C.dim}(${time}${cost})${C.reset}`);
  if (r.error) log(`    ${C.red}错误: ${r.error}${C.reset}`);
  for (const a of r.artifacts) log(`    ${C.dim}产出: ${a}${C.reset}`);
}

// ─── 主流程 ─────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.setup) {
    await runSetupWizard();
    return;
  }

  if (!args.idea) {
    log(`${C.yellow}用法: npm start -- [选项] "项目描述"${C.reset}`);
    log(`   --setup, -s            配置向导`);
    log(`   --config, -c <path>    配置文件 (默认: workflow.config.json)`);
    log(`   --image, -i <path>     附加图片`);
    log(`   --from <stage>         起始阶段`);
    log(`   --to <stage>           结束阶段`);
    log(`   --project, -p <name>   输出到 output_projects/<name>/`);
    log(`   --answers, -a <path>   答案文件 (替代键盘输入)`);
    log(`   --override, -o <s:m>   覆盖模型`);
    process.exit(1);
  }

  // 加载配置
  if (!existsSync(args.config)) {
    log(`${C.red}找不到: ${args.config}${C.reset}`);
    process.exit(1);
  }
  let config = await loadConfig(args.config);

  // 项目输出目录
  const projectDir = args.project ? "output_projects/" + args.project : null;
  if (projectDir) {
    config.outputDir = projectDir;
    log(`  ${C.dim}项目输出: ${projectDir}/${C.reset}`);
  }

  // 应用 overrides
  for (const [stage, model] of Object.entries(args.overrides)) {
    if (config.stages[stage]) {
      config.stages[stage].model = model;
      log(`${C.dim}  覆写 ${stage}: ${model}${C.reset}`);
    }
  }

  // 加载图片
  const loadedImages: ImageInput[] = [];
  const MEDIA_TYPES: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
  };
  for (const imgPath of args.images) {
    if (!existsSync(imgPath)) { log(`  ${C.yellow}图片不存在: ${imgPath}${C.reset}`); continue; }
    const ext = extname(imgPath).toLowerCase();
    const mt = MEDIA_TYPES[ext];
    if (!mt) { log(`  ${C.yellow}不支持的格式: ${imgPath}${C.reset}`); continue; }
    loadedImages.push({ path: imgPath, mediaType: mt, base64: readFileSync(imgPath).toString("base64") });
    log(`  ${C.dim}图片: ${imgPath}${C.reset}`);
  }

  // 创建 AgentFactory
  const agentFactory = createPiAgentFactory();
  const answersArg = args.answers;

  const stageRunner: StageRunner = async (params) => {
    const startTime = Date.now();
    const session = await agentFactory.createSession({
      modelRef: params.modelRef,
      thinking: params.config.thinking,
    });

    let output = "";
    let cost = 0;

    const stageStartTime = Date.now();
    let toolCallCount = 0;

    session.subscribe((event: any) => {
      if (event?.type === "message_update" && event?.assistantMessageEvent?.type === "text_delta") {
        const d = event.assistantMessageEvent.delta ?? "";
        output += d;
        process.stdout.write(d);
      }
      if (event?.type === "message_end" && event?.message?.role === "assistant" && event?.message?.usage?.cost?.total) {
        cost += event.message.usage.cost.total;
      }
      if (event?.type === "tool_execution_start") {
        toolCallCount++;
        const elapsed = ((Date.now() - stageStartTime) / 1000).toFixed(0);
        const args = event.args ?? {};
        const cmd = event.toolName === "bash" ? (args.command ?? "").substring(0, 80) : event.toolName;
        process.stdout.write(C.dim + "[" + elapsed + "s] " + C.reset + C.yellow + "\u2699 " + cmd + C.reset + "\n");
      }
      if (event?.type === "tool_execution_end") {
        const elapsed = ((Date.now() - stageStartTime) / 1000).toFixed(0);
        const icon = event.isError ? "\u2716" : "\u2714";
        const color = event.isError ? C.red : C.green;
        process.stdout.write(C.dim + "[" + elapsed + "s] " + color + icon + C.reset + "\n");
      }
    });

    // 构建 prompt
    const promptLines = [
      "## 工作流阶段: " + params.stage + (params.config.label ? " (" + params.config.label + ")" : ""),
      "",
      "模型: " + params.modelRef,
      params.config.skill ? '\n请使用 "' + params.config.skill + '" 技能来完成此阶段的工作。\n' : "",
      "",
      "## 上下文",
      "",
      params.context,
    ];

    // 项目输出目录提示（告诉 agent 文件放哪）
    if (projectDir) {
      promptLines.push(
        "",
        "## 输出目录规范",
        "",
        "所有产出物请放在以下目录:",
        "- 阶段文档: " + projectDir + "/<stage>/",
        "- 计划文件: " + projectDir + "/plans/",
        "- 项目代码: " + projectDir + "/code/",
        "- E2E 截图: " + projectDir + "/screenshots/",
      );
    }

    // E2E 分阶段指引
    const e2eCfg = config.stages.verification?.e2e;
    const ssScript = resolve(import.meta.dirname!, "e2e-screenshot.mjs");
    const vp = e2eCfg?.viewport ? e2eCfg.viewport.width + "x" + e2eCfg.viewport.height : "1280x720";

    if (e2eCfg && params.stage === "brainstorming") {
      promptLines.push("", "## E2E 测试策略", "", "项目包含前端页面，请在设计中考虑 E2E 测试需求。", "后续阶段会设计并实现 Playwright 测试。", "注明哪些功能点需要截图验证。");

    } else if (e2eCfg && params.stage === "writing-plans") {
      promptLines.push(
        "", "## E2E 测试设计", "",
        "请设计 3-5 个核心 E2E 场景。",
        "", "### 基础设施",
        "- Dev server: `" + e2eCfg.devCommand + "` 启动在 " + e2eCfg.baseUrl,
        "- 视口: " + vp,
        "", "### 要求",
        "1. 设计用户场景（访问首页 → 导航 → 交互 → 验证）",
        "2. 每个场景指定: 步骤、预期结果、截图检查点",
        "3. 计划文件放 " + (projectDir || "docs/superpowers") + "/plans/",
        "4. 后续阶段会实现 Playwright 脚本",
      );

    } else if (e2eCfg && params.stage === "executing-plans") {
      const ssDir = projectDir ? projectDir + "/screenshots" : "screenshots";
      promptLines.push(
        "", "## E2E 测试实现", "",
        "根据上一阶段设计的 E2E 场景，用 Playwright 实现。",
        "", "### 要求",
        "1. 安装 Playwright: `npm install --save-dev playwright`",
        "2. 创建 tests/e2e/ 目录编写测试",
        "3. 每个场景含截图: await page.screenshot({ path: '" + ssDir + "/场景名.png' })",
        "4. 断言 URL、文本、元素可见性",
        "5. 测试可独立运行: `npx playwright test tests/e2e/`",
        "", "### 基础设施",
        "- Dev server: `" + e2eCfg.devCommand + "` 启动在 " + e2eCfg.baseUrl,
        "- 视口: " + vp,
        "- 代码目录: " + (projectDir ? projectDir + "/code/" : "当前目录"),
      );

    } else if (e2eCfg && params.stage === "verification") {
      const ssDir = projectDir ? projectDir + "/screenshots" : "screenshots";
      promptLines.push(
        "", "## E2E 视觉验证", "",
        "执行前序阶段设计的 E2E 测试，通过截图验证页面渲染。",
        "", "### 步骤",
        "1. 启动 dev server: `" + e2eCfg.devCommand + "`",
        "2. 运行测试: `npx playwright test tests/e2e/`",
        "   - 如果 tests/e2e/ 不存在，手动截图:",
        '     node "' + ssScript + '" --base-url ' + e2eCfg.baseUrl + " --output " + ssDir + " --paths / --viewport " + vp,
        "3. 用 read 查看每张截图，检查:",
        "   - 是否白屏、渲染错误",
        "   - 布局、UI 元素是否正常",
        "4. 异常则分析修复，重新截图验证",
        "", "重要: 必须亲眼查看截图，不能只依赖状态码。",
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

          let userInput: string;
          if (answersArg && existsSync(answersArg)) {
            const raw = readFileSync(answersArg, "utf-8");
            // 按 --- 分隔符切分为多个答案，每个答案可跨多行
            const segments = raw.split(/\n-{3,}\n/);
            let usedIdx = -1;
            for (let si = 0; si < segments.length; si++) {
              const text = segments[si].trim();
              // 跳过纯注释的段
              const cleanLines = text.split("\n").filter(function(l) {
                return !l.trim().startsWith("#");
              });
              if (cleanLines.length > 0 && cleanLines.some(function(l) { return l.trim(); })) {
                usedIdx = si;
                break;
              }
            }
            if (usedIdx >= 0) {
              userInput = segments[usedIdx].trim();
              segments.splice(usedIdx, 1);
              writeFileSync(answersArg, segments.join("\n---\n"), "utf-8");
              console.log("\n  [答案:\n" + userInput + "\n  ]");
            } else {
              userInput = "";
            }
          } else {
            const rl = readline.createInterface({ input: rlInput, output: rlOutput });
            userInput = await rl.question("\n  " + C.cyan + "你的补充" + C.reset + " (回车结束): ");
            rl.close();
          }
          if (!userInput.trim()) break;
          currentPrompt = userInput;
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

  // 执行工作流
  const stageNames = Object.keys(config.stages);
  log(`${C.bold}my-llm-workflow${C.reset}`);
  log(`${C.dim}  ${stageNames.length} 阶段 | ${args.config}${C.reset}`);
  log(`${C.dim}  ${"-".repeat(35)}${C.reset}`);

  const report = await runWorkflow(
    {
      config,
      idea: args.idea,
      outputDir: config.outputDir,
      from: args.from,
      to: args.to,
      onStageStart: (stage) => logStage(stage, stageNames.indexOf(stage), stageNames.length, config.stages[stage]),
      onStageComplete: (record) => logStageResult(record),
    },
    stageRunner,
  );

  // 总结
  const sc = report.status === "success" ? C.green : report.status === "partial" ? C.yellow : C.red;
  const si = report.status === "success" ? "OK" : report.status === "partial" ? "WARN" : "FAIL";
  log(`\n${C.bold}${sc}${si} 工作流: ${report.status}${C.reset}`);
  log(`  ${C.dim}耗时: ${(report.totalDuration / 1000).toFixed(1)}s  | 成本: $${report.totalCost.toFixed(4)}${C.reset}`);

  const allArtifacts = report.stages.flatMap((r) => r.artifacts);
  if (allArtifacts.length > 0) {
    log("  产出:");
    for (const a of allArtifacts) log(`    ${C.dim}* ${a}${C.reset}`);
  }
}

main().catch((err) => {
  console.error("错误: " + err.message);
  process.exit(1);
});
