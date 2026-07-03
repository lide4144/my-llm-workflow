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
    if (arg === "--setup" || arg === "-s") { setup = true; }
    else if (arg === "--project" || arg === "-p") { project = args[++i]; }
    else if (arg === "--answers" || arg === "-a") { answers = args[++i]; }
    else if (arg === "--config" || arg === "-c") { config = args[++i]; }
    else if (arg === "--image" || arg === "-i") { images.push(args[++i]); }
    else if (arg === "--from") { from = args[++i]; }
    else if (arg === "--to") { to = args[++i]; }
    else if (arg === "--override" || arg === "-o") {
      const val = args[++i]; const ci = val.indexOf(":");
      if (ci > 0) overrides[val.slice(0, ci)] = val.slice(ci + 1);
    } else if (arg === "--help" || arg === "-h") { positional.push("--help"); break; }
    else if (!arg.startsWith("--")) { positional.push(arg); }
  }
  return { config, idea: positional.join(" ").trim(), from, to, overrides, images, project, answers, setup };
}

// ─── 彩色 log ───────────────────────────────────────────────

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", green: "\x1b[32m",
  yellow: "\x1b[33m", red: "\x1b[31m", cyan: "\x1b[36m", bold: "\x1b[1m",
};

// ─── 工作流管道显示 ─────────────────────────────────────────

const stageStartTimes: Record<number, number> = {};
const stageResults: Array<{ status: string; duration: number; cost: number }> = [];
let pipelineDrawn = false;

function drawPipeline(stageNames: string[], config: WorkflowConfig, currentIdx: number) {
  // 第一次画, 直接输出; 之后更新最后几行
  let output = "\n" + C.bold + "工作流管道" + C.reset + "\n";

  for (let i = 0; i < stageNames.length; i++) {
    const name = stageNames[i];
    const cfg = config.stages[name];
    const isCurrent = i === currentIdx;
    const isDone = i < currentIdx;
    const hasResult = i < stageResults.length;

    let line = "  ";
    if (isDone && hasResult) {
      const r = stageResults[i];
      const time = ((r.duration || 0) / 1000).toFixed(1);
      const status = r.status === "success" ? "OK" : r.status === "failure" ? "FAIL" : "--";
      line += C.green + status + C.reset + " " + name + C.dim + " (" + time + "s)" + C.reset;
    } else if (isCurrent) {
      const elapsed = ((Date.now() - (stageStartTimes[i] || Date.now())) / 1000).toFixed(0);
      line += C.cyan + C.bold + " >>" + C.reset + " " + name + " " + C.yellow + elapsed + "s" + C.reset;
      if (cfg.label) line += C.dim + " (" + cfg.label + ")" + C.reset;
    } else if (isDone) {
      line += C.green + " OK" + C.reset + " " + name + C.dim + C.reset;
    } else {
      line += C.dim + " .. " + name + C.reset;
    }
    line += "  " + C.dim + cfg.model + C.reset;
    output += line + "\n";
  }

  output += C.dim + "  " + "-".repeat(35) + C.reset + "\n";

  if (!pipelineDrawn) {
    process.stdout.write(output);
    pipelineDrawn = true;
  } else {
    // 向上移动(stageNames.length + 3)行并重绘
    const lines = stageNames.length + 3;
    process.stdout.write("\x1b[" + lines + "A\x1b[0J");
    process.stdout.write(output);
  }
}

// ─── 阶段日志 ───────────────────────────────────────────────

// 运行时 config 引用 (由 main 设置)
let activeConfig: WorkflowConfig;

function logStage(name: string, idx: number, total: number, cfg: { model: string; label?: string }) {
  stageStartTimes[idx] = Date.now();
  drawPipeline(Object.keys(activeConfig.stages), activeConfig, idx);
}

function logStageResult(r: StageResult) {
  stageResults.push({ status: r.status, duration: r.duration, cost: r.cost });
  const icon = r.status === "success" ? "OK" : r.status === "failure" ? "FAIL" : "--";
  const color = r.status === "success" ? C.green : C.red;
  const time = ((r.duration || 0) / 1000).toFixed(1);
  const cost = r.cost > 0 ? ", $" + r.cost.toFixed(4) : "";
  // 阶段详情在管道下方显示
  process.stdout.write("  " + color + icon + C.reset + " " + r.stage + C.dim + " (" + time + "s" + cost + ")" + C.reset + "\n");
  if (r.error) process.stdout.write("    " + C.red + r.error + C.reset + "\n");
  for (const a of r.artifacts) process.stdout.write("    " + C.dim + a + C.reset + "\n");
}

// ─── 主流程 ─────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.setup) { await runSetupWizard(); return; }

  if (!args.idea || args.idea === "--help") {
    console.log("");
    console.log("my-llm-workflow — 多 Agent LLM 工作流编排器");
    console.log("");
    console.log("用法:");
    console.log("  npm start -- \"项目描述\"");
    console.log("  npm start -- --project myapp --answers ans.txt \"项目描述\"");
    console.log("");
    console.log("工作流阶段 (4步):");
    console.log("  1. brainstorming  — Gemini 3.1 Pro 充实方案");
    console.log("  2. writing-plans  — GLM 5.2 搭建计划");
    console.log("  3. executing-plans — DeepSeek V4 Flash 编码");
    console.log("  4. verification   — GPT-5.5 审查验证");
    console.log("");
    console.log("选项:");
    console.log("  --project, -p <name>   项目名称, 输出到 output_projects/<name>/");
    console.log("  --answers, -a <path>   从文件读取多轮回答");
    console.log("  --config, -c <path>    配置文件 (默认: workflow.config.json)");
    console.log("  --from <stage>         起始阶段");
    console.log("  --to <stage>           结束阶段");
    console.log("  --image, -i <path>     附加图片");
    console.log("  --override, -o <s:m>   覆盖某阶段的模型");
    console.log("  --setup, -s            交互式模型配置向导");
    console.log("  --help, -h             显示此帮助");
    console.log("");
    console.log("答案文件格式:");
    console.log("  每个答案用 --- 分隔");
    console.log("  答案文件示例:");
    console.log("    2-4人对战");
    console.log("    最后存活者获胜");
    console.log("    ---");
    console.log("    在现有基础上开发");
    console.log("");
    process.exit(0);
  }

  if (!existsSync(args.config)) { console.log("找不到: " + args.config); process.exit(1); }
  let config = await loadConfig(args.config);
  activeConfig = config;
  const projectDir = args.project ? "output_projects/" + args.project : null;
  if (projectDir) { config.outputDir = projectDir; console.log("项目输出: " + projectDir); }

  for (const [stage, model] of Object.entries(args.overrides)) {
    if (config.stages[stage]) { config.stages[stage].model = model; }
  }

  // 加载图片
  const loadedImages: ImageInput[] = [];
  for (const imgPath of args.images) {
    if (!existsSync(imgPath)) continue;
    const ext = extname(imgPath).toLowerCase();
    const mt = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp" })[ext];
    if (!mt) continue;
    loadedImages.push({ path: imgPath, mediaType: mt, base64: readFileSync(imgPath).toString("base64") });
  }

  const agentFactory = createPiAgentFactory(projectDir ? { projectDir } : undefined);
  const answersArg = args.answers;

  const stageRunner: StageRunner = async (params) => {
    const startTime = Date.now();
    const session = await agentFactory.createSession({
      modelRef: params.modelRef,
      thinking: params.config.thinking,
    });

    let output = "";
    let cost = 0;

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
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const cmd = event.toolName === "bash" ? (event.args?.command ?? "").substring(0, 80) : event.toolName;
        process.stdout.write(C.dim + "[" + elapsed + "s] " + C.reset + C.yellow + cmd + C.reset + "\n");
      }
      if (event?.type === "tool_execution_end") {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        process.stdout.write(C.dim + "[" + elapsed + "s] " + (event.isError ? C.red + "FAIL" : C.green + "OK") + C.reset + "\n");
      }
    });

    // 构建 prompt
    const promptLines = [
      "## 工作流阶段: " + params.stage + (params.config.label ? " (" + params.config.label + ")" : ""),
      "",
      "模型: " + params.modelRef,
      params.config.skill ? '\n请使用 "' + params.config.skill + '" 技能来完成此阶段的工作。\n' : "",
      "",
      "## 上下文", "",
      params.context,
    ];

    if (projectDir) {
      promptLines.push(
        "", "## 输出目录", "",
        "所有产出物放在以下目录:",
        "- 文档 → " + projectDir + "/<stage>/",
        "- 计划 → " + projectDir + "/plans/",
        "- 代码 → " + projectDir + "/code/",
        "- 截图 → " + projectDir + "/screenshots/",
        "",
        "项目代码使用独立 git 仓库，在 " + projectDir + "/code/ 下 init。",
        "工作流根目录 (my-llm-workflow) 不要执行 git 操作。",
      );
    }

    const e2eCfg = config.stages.verification?.e2e;
    const ssScript = resolve(import.meta.dirname!, "e2e-screenshot.mjs");
    const vp = e2eCfg?.viewport ? e2eCfg.viewport.width + "x" + e2eCfg.viewport.height : "1280x720";

    if (e2eCfg && params.stage === "brainstorming") {
      promptLines.push("", "## E2E 测试策略", "", "项目包含前端页面，请在设计中考虑 E2E 测试需求。", "注明哪些功能点需要截图验证。");
    } else if (e2eCfg && params.stage === "writing-plans") {
      promptLines.push("", "## E2E 测试设计", "", "请设计 3-5 个核心 E2E 场景。", "- Dev server: " + e2eCfg.devCommand + " -> " + e2eCfg.baseUrl, "- 视口: " + vp, "计划文件放 " + (projectDir || "docs/superpowers") + "/plans/");
    } else if (e2eCfg && params.stage === "executing-plans") {
      const ssD = projectDir ? projectDir + "/screenshots" : "screenshots";
      promptLines.push("", "## E2E 测试实现", "", "根据上一阶段设计的场景用 Playwright 实现。", "截图: await page.screenshot({ path: '" + ssD + "/场景名.png' })", "代码目录: " + (projectDir ? projectDir + "/code/" : "当前目录"));
    } else if (e2eCfg && params.stage === "verification") {
      const ssD = projectDir ? projectDir + "/screenshots" : "screenshots";
      promptLines.push("", "## E2E 视觉验证", "", "执行 E2E 测试，通过截图验证页面渲染。", "1. 启动: " + e2eCfg.devCommand, "2. 运行: npx playwright test tests/e2e/", '   手动截图: node "' + ssScript + '" --base-url ' + e2eCfg.baseUrl + " --output " + ssD + " --paths / --viewport " + vp, "3. 用 read 查看截图，检查白屏/渲染错误", "重要: 必须亲眼查看截图。");
    }

    const promptText = promptLines.join("\n");

    try {
      const hasImages = loadedImages.length > 0 && params.stage === Object.keys(config.stages)[0];

      if (params.config.interactive) {
        let turn = 0, currentPrompt = promptText, passImages = hasImages;
        while (turn < 10) {
          await session.prompt(currentPrompt, passImages ? { images: loadedImages } : undefined);
          turn++; passImages = false;
          let userInput: string;
          if (answersArg && existsSync(answersArg)) {
            const raw = readFileSync(answersArg, "utf-8");
            const segs = raw.split(/\n-{3,}\n/);
            let used = -1;
            for (let si = 0; si < segs.length; si++) {
              const t = segs[si].trim();
              const cl = t.split("\n").filter((l: string) => !l.trim().startsWith("#"));
              if (cl.length > 0 && cl.some((l: string) => l.trim())) { used = si; break; }
            }
            if (used >= 0) {
              userInput = segs[used].trim();
              segs.splice(used, 1);
              writeFileSync(answersArg, segs.join("\n---\n"), "utf-8");
              process.stdout.write("\n  [答案: " + userInput.substring(0, 60) + "...]\n");
            } else { userInput = ""; }
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

      const meta = await saveArtifact({
        outputDir: params.outputDir, stage: params.stage,
        fileName: "stage-" + params.stage + "-output.md",
        content: output || "# " + params.stage + "\n\n(无文本输出)\n",
      });
      return { stage: params.stage, model: params.modelRef, status: "success", duration: Date.now() - startTime, cost, outputDir: params.outputDir, artifacts: [meta.path] };
    } catch (err) {
      return { stage: params.stage, model: params.modelRef, status: "failure", duration: Date.now() - startTime, cost, outputDir: params.outputDir, artifacts: [], error: err instanceof Error ? err.message : String(err) };
    } finally { session.dispose(); }
  };

  // 执行工作流
  const stageNames = Object.keys(config.stages);

  const report = await runWorkflow(
    {
      config, idea: args.idea, outputDir: config.outputDir,
      from: args.from, to: args.to,
      onStageStart: (stage) => logStage(stage, stageNames.indexOf(stage), stageNames.length, config.stages[stage]),
      onStageComplete: (record) => logStageResult(record),
    },
    stageRunner,
  );

  const sc = report.status === "success" ? C.green : report.status === "partial" ? C.yellow : C.red;
  const si = report.status === "success" ? "OK" : report.status === "partial" ? "WARN" : "FAIL";
  process.stdout.write("\n" + C.bold + sc + si + " 工作流: " + report.status + C.reset + "\n");
  process.stdout.write(C.dim + "  总耗时: " + (report.totalDuration / 1000).toFixed(1) + "s  总成本: $" + report.totalCost.toFixed(4) + C.reset + "\n");

  const allArtifacts = report.stages.flatMap((r) => r.artifacts);
  if (allArtifacts.length > 0) {
    process.stdout.write("  产出:\n");
    for (const a of allArtifacts) process.stdout.write("    " + C.dim + "* " + a + C.reset + "\n");
  }
}

main().catch((err) => { console.error("错误: " + err.message); process.exit(1); });
