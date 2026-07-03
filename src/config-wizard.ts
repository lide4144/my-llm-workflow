/**
 * 交互式模型配置向导
 *
 * 用法: npm start -- --setup
 * 功能: 扫描已配置 API key 的 provider，让你为每个阶段交互式选择模型
 */

import { existsSync, writeFileSync } from "node:fs";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { loadConfig, type WorkflowConfig, type StageConfig } from "./config.js";

const CONFIG_PATH = "workflow.config.json";

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

export async function runSetupWizard(): Promise<void> {
  console.log(`\n${C.bold}${C.cyan}🔧 my-llm-workflow 配置向导${C.reset}`);
  console.log(`${C.dim}扫描已配置的 API key...${C.reset}\n`);

  // 1. 获取所有可用模型
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const available = await modelRegistry.getAvailable();

  if (available.length === 0) {
    console.log(`${C.red}❌ 没有找到可用模型。${C.reset}`);
    console.log(`请先配置 API key：`);
    console.log(`  • 环境变量: export ANTHROPIC_API_KEY=sk-...`);
    console.log(`  • 或在 pi 中使用 /login 命令登录后，本工具会自动读取。`);
    process.exit(1);
  }

  // 2. 按 provider 分组展示
  const byProvider: Record<string, typeof available> = {};
  for (const m of available) {
    const p = m.provider;
    if (!byProvider[p]) byProvider[p] = [];
    byProvider[p].push(m);
  }

  console.log(`${C.bold}🔑 已配置 API key 的 Provider:${C.reset}`);
  for (const [provider, models] of Object.entries(byProvider)) {
    console.log(`  ${C.green}✓${C.reset} ${provider} (${models.length} 个模型)`);
  }

  // 3. 构建选择列表
  const choices: Array<{
    index: number;
    label: string;
    provider: string;
    id: string;
  }> = [];
  for (const m of available) {
    choices.push({
      index: choices.length + 1,
      label: `${m.provider}/${m.id}`,
      provider: m.provider,
      id: m.id,
    });
  }

  console.log(`\n${C.bold}📋 可用模型列表:${C.reset}`);
  for (const c of choices) {
    console.log(`  ${C.cyan}${String(c.index).padStart(2)}${C.reset}) ${c.label}`);
  }

  // 4. 加载或创建配置
  let config: WorkflowConfig;
  if (existsSync(CONFIG_PATH)) {
    config = await loadConfig(CONFIG_PATH);
    console.log(`\n${C.dim}已加载现有配置: ${CONFIG_PATH}${C.reset}`);
  } else {
    // 创建默认配置
    config = createDefaultConfig(choices);
    console.log(`\n${C.dim}未找到配置，创建默认配置${C.reset}`);
  }

  // 5. 交互式选择
  const rl = readline.createInterface({ input, output });
  const stageNames = Object.keys(config.stages);

  console.log(`\n${C.bold}🎯 请为每个阶段选择模型 (输入编号，回车保持不变):${C.reset}`);

  for (let i = 0; i < stageNames.length; i++) {
    const name = stageNames[i];
    const stage = config.stages[name];
    const currentIdx = choices.findIndex((c) => c.label === stage.model);

    console.log(`\n${C.bold}阶段 ${i + 1}/${stageNames.length}: ${name}${C.reset}${stage.label ? ` ${C.dim}(${stage.label})${C.reset}` : ""}`);
    console.log(`  ${C.dim}当前: ${stage.model}${C.reset}`);

    const defaultVal = currentIdx >= 0 ? String(currentIdx + 1) : "";
    const answer = await rl.question(`  选择 (1-${choices.length}, 回车不变): `);
    const trimmed = answer.trim();

    if (trimmed) {
      const num = parseInt(trimmed, 10);
      if (num >= 1 && num <= choices.length) {
        const chosen = choices[num - 1];
        stage.model = chosen.label;
        console.log(`  ${C.green}✓${C.reset} 已选择: ${chosen.label}`);
      } else {
        console.log(`  ${C.yellow}无效输入，保持: ${stage.model}${C.reset}`);
      }
    } else {
      console.log(`  ${C.dim}保持不变: ${stage.model}${C.reset}`);
    }
  }

  rl.close();

  // 6. 保存配置
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
  console.log(`\n${C.green}✅ 配置已保存到 ${CONFIG_PATH}${C.reset}`);

  // 7. 展示最终配置
  console.log(`\n${C.bold}📄 最终配置:${C.reset}`);
  for (const [name, stage] of Object.entries(config.stages)) {
    console.log(`  ${C.cyan}${name}${C.reset}: ${C.bold}${stage.model}${C.reset}${stage.thinking ? ` (thinking: ${stage.thinking})` : ""}`);
  }
  console.log();
}

function createDefaultConfig(choices: Array<{ label: string }>): WorkflowConfig {
  const pick = (idx: number) => choices[Math.min(idx, choices.length - 1)]?.label ?? choices[0]?.label ?? "unknown/model";

  return {
    outputDir: "docs/superpowers",
    stages: {
      brainstorming: {
        label: "需求探讨与方案设计",
        model: pick(0),
        thinking: "high",
        skill: "brainstorming",
        onFailure: "stop",
      },
      "writing-plans": {
        label: "编写实施计划",
        model: pick(0),
        thinking: "medium",
        skill: "writing-plans",
        onFailure: "stop",
      },
      "executing-plans": {
        label: "执行开发计划",
        model: pick(Math.min(1, choices.length - 1)),
        thinking: "off",
        skill: "subagent-driven-development",
        onFailure: "continue",
      },
      verification: {
        label: "验证与检查",
        model: pick(0),
        thinking: "low",
        skill: "verification-before-completion",
        onFailure: "continue",
      },
    },
  };
}
