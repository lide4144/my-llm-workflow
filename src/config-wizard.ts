/**
 * 交互式配置向导 — Provider 管理 + 模型选择
 *
 * 用法: npm start -- --setup
 *
 * 功能:
 *   1. 浏览所有已知 provider 和它们的状态
 *   2. 输入/修改 API key
 *   3. 添加自定义 provider (Ollama, vLLM 等)
 *   4. 为每个工作流阶段选择模型
 */

import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { loadConfig, type WorkflowConfig, type StageConfig } from "./config.js";

// ─── 路径 ─────────────────────────────────────────────────────

const PI_AGENT_DIR = join(homedir(), ".pi", "agent");
const AUTH_PATH = join(PI_AGENT_DIR, "auth.json");
const MODELS_PATH = join(PI_AGENT_DIR, "models.json");
const CONFIG_PATH = "workflow.config.json";

// ─── 颜色 ─────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

// ─── Provider 列表（已知的内置 provider）─────────────────────

// 分组展示，更直观
// 所有 pi 内置 provider（来自 pi ModelRegistry），分组展示
const PROVIDER_GROUPS: Array<{ label: string; providers: string[] }> = [
  {
    label: "主流 API",
    providers: ["anthropic", "openai", "google", "deepseek", "mistral"],
  },
  {
    label: "聚合路由",
    providers: ["openrouter", "vercel-ai-gateway", "cloudflare-ai-gateway"],
  },
  {
    label: "国内服务",
    providers: [
      "zai",
      "zai-coding-cn",
      "kimi-coding",
      "minimax",
      "minimax-cn",
      "moonshotai",
      "moonshotai-cn",
      "xiaomi",
      "xiaomi-token-plan-cn",
    ],
  },
  {
    label: "云平台",
    providers: [
      "amazon-bedrock",
      "azure-openai-responses",
      "google-vertex",
    ],
  },
  {
    label: "代码 & 平台",
    providers: [
      "openai-codex",
      "github-copilot",
      "opencode",
      "opencode-go",
    ],
  },
  {
    label: "其他",
    providers: [
      "ant-ling",
      "cerebras",
      "cloudflare-workers-ai",
      "fireworks",
      "groq",
      "huggingface",
      "nvidia",
      "together",
      "xai",
      "xiaomi-token-plan-ams",
      "xiaomi-token-plan-sgp",
    ],
  },
];

/** 拍平所有内置 provider 名 */
const ALL_BUILTIN_PROVIDERS = PROVIDER_GROUPS.flatMap((g) => g.providers);

// ─── 工具函数 ─────────────────────────────────────────────────

function readAuth(): Record<string, any> {
  try {
    return JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeAuth(data: Record<string, any>): void {
  mkdirSync(PI_AGENT_DIR, { recursive: true });
  writeFileSync(AUTH_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function readModels(): Record<string, any> {
  try {
    return JSON.parse(readFileSync(MODELS_PATH, "utf-8"));
  } catch {
    return { providers: {} };
  }
}

function writeModels(data: Record<string, any>): void {
  mkdirSync(PI_AGENT_DIR, { recursive: true });
  writeFileSync(MODELS_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function providerHasKey(auth: Record<string, any>, provider: string): boolean {
  const entry = auth[provider];
  if (!entry) return false;
  if (entry.type === "api_key" && entry.key) return true;
  if (entry.type === "oauth" && entry.access) return true;
  return false;
}

// ─── 主向导 ───────────────────────────────────────────────────

export async function runSetupWizard(): Promise<void> {
  console.log(`\n${C.bold}${C.cyan}🔧 my-llm-workflow 配置向导${C.reset}\n`);

  // 读取当前认证状态
  const auth = readAuth();
  const modelsConfig = readModels();
  const customProviders = Object.keys(modelsConfig.providers ?? {});

  // ── 第一步: Provider 管理 ──────────────────────────────────

  await manageProviders(auth, modelsConfig, customProviders);

  // ── 第二步: 模型选择 ──────────────────────────────────────

  await selectModels(auth, modelsConfig);
}

// ═══════════════════════════════════════════════════════════════
//  第一步：Provider 管理
// ═══════════════════════════════════════════════════════════════

async function manageProviders(
  auth: Record<string, any>,
  modelsConfig: Record<string, any>,
  customProviders: string[]
): Promise<void> {
  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      console.log(`\n${C.bold}${C.cyan}═══ 📦 Provider 管理 ═══${C.reset}\n`);

      // 展示已配置的（从 auth.json 中读取所有有 key 的 provider）
      const configured = Object.keys(auth).filter((p) => providerHasKey(auth, p));
      if (configured.length > 0) {
        console.log(`${C.bold}已配置 key:${C.reset}`);
        for (const p of configured) {
          const models = await countModels(p, auth, modelsConfig);
          console.log(`  ${C.green}✓${C.reset} ${p} ${C.dim}(${models} 个模型)${C.reset}`);
        }
      } else {
        console.log(`  ${C.dim}(尚无已配置的 provider)${C.reset}`);
      }

      // 展示自定义 provider
      if (customProviders.length > 0) {
        console.log(`\n${C.bold}自定义 provider:${C.reset}`);
        for (const p of customProviders) {
          console.log(`  ${C.green}✦${C.reset} ${p}`);
        }
      }

      // 展示分组中未配置的
      console.log(`\n${C.bold}可配置的内置 provider:${C.reset}`);
      let idx = 1;
      const menuItems: Array<{ type: "builtin"; provider: string } | { type: "custom" }> = [];

      for (const group of PROVIDER_GROUPS) {
        const unconfigured = group.providers.filter((p) => !providerHasKey(auth, p));
        if (unconfigured.length === 0) continue;

        console.log(`  ${C.dim}${group.label}:${C.reset}`);
        for (const p of unconfigured) {
          console.log(`    ${C.cyan}${idx}${C.reset}) ${p}`);
          menuItems.push({ type: "builtin", provider: p });
          idx++;
        }
      }

      // 添加自定义 provider 选项
      const customIdx = idx;
      console.log(`    ${C.cyan}${customIdx}${C.reset}) ${C.yellow}+ 添加自定义 provider (Ollama, vLLM, LM Studio...)${C.reset}`);
      menuItems.push({ type: "custom" });

      const doneIdx = customIdx + 1;
      console.log(`    ${C.cyan}${doneIdx}${C.reset}) ${C.green}✓ 完成，进入模型选择${C.reset}`);

      const answer = await rl.question(`\n选择 (1-${doneIdx}): `);
      const num = parseInt(answer.trim(), 10);

      if (num === doneIdx) {
        break;
      }

      if (num >= 1 && num <= menuItems.length) {
        const item = menuItems[num - 1];
        if (item.type === "builtin") {
          await configureBuiltinProvider(rl, auth, item.provider);
        } else if (item.type === "custom") {
          await addCustomProvider(rl, modelsConfig);
          customProviders.length = 0;
          customProviders.push(...Object.keys(modelsConfig.providers ?? {}));
        }
      }
    }
  } finally {
    rl.close();
  }
}

async function configureBuiltinProvider(
  rl: readline.Interface,
  auth: Record<string, any>,
  provider: string
): Promise<void> {
  console.log(`\n${C.bold}配置 ${provider}${C.reset}`);

  const existing = auth[provider];
  if (existing) {
    console.log(`  当前已有 key: ${C.dim}${maskKey(existing.key ?? "")}${C.reset}`);
    const change = await rl.question(`  是否替换? (y/N): `);
    if (change.trim().toLowerCase() !== "y") {
      console.log(`  ${C.dim}保持不变${C.reset}`);
      return;
    }
  }

  const key = await rl.question(`  输入 API key: `);
  if (key.trim()) {
    auth[provider] = { type: "api_key", key: key.trim() };
    writeAuth(auth);
    console.log(`  ${C.green}✓${C.reset} ${provider} key 已保存${C.reset}`);
  }
}

async function addCustomProvider(
  rl: readline.Interface,
  modelsConfig: Record<string, any>
): Promise<void> {
  console.log(`\n${C.bold}添加自定义 provider${C.reset}`);
  console.log(`  ${C.dim}适用于 Ollama, vLLM, LM Studio, 或其他 OpenAI 兼容服务${C.reset}`);

  const name = await rl.question(`  Provider 名称: `);
  if (!name.trim()) {
    console.log(`  ${C.yellow}已取消${C.reset}`);
    return;
  }

  const baseUrl = await rl.question(`  API 地址 (如 http://localhost:11434): `);
  if (!baseUrl.trim()) {
    console.log(`  ${C.yellow}已取消${C.reset}`);
    return;
  }

  // 自动补全 /v1 路径
  let apiBase = baseUrl.trim().replace(/\/+$/, "");
  if (!apiBase.endsWith("/v1")) {
    apiBase += "/v1";
  }

  const apiKey = await rl.question(`  API key (如不需要则回车跳过): `);

  // ── 自动获取模型列表 ──────────────────────────────────────
  console.log(`  ${C.dim}正在从 ${apiBase}/models 获取模型列表...${C.reset}`);

  let modelIds: string[] = [];
  let fetchFailed = false;

  try {
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (apiKey.trim()) {
      headers["Authorization"] = `Bearer ${apiKey.trim()}`;
    }

    const response = await fetch(`${apiBase}/models`, { headers, signal: AbortSignal.timeout(5000) });

    if (response.ok) {
      const data = await response.json() as any;

      // OpenAI 兼容格式: { data: [{ id: "..." }, ...] }
      if (data?.data && Array.isArray(data.data)) {
        modelIds = data.data.map((m: any) => m.id).filter(Boolean);
      }
      // Ollama /api/tags 格式: { models: [{ name: "..." }, ...] }
      else if (data?.models && Array.isArray(data.models)) {
        modelIds = data.models.map((m: any) => m.name).filter(Boolean);
      }

      if (modelIds.length > 0) {
        console.log(`  ${C.green}✓${C.reset} 发现 ${modelIds.length} 个模型:`);
        for (const id of modelIds) {
          console.log(`    ${C.cyan}•${C.reset} ${id}`);
        }

        const confirm = await rl.question(`  使用以上全部模型? (Y/n): `);
        if (confirm.trim().toLowerCase() === "n") {
          // 让用户选择要包含的模型
          console.log(`  ${C.dim}输入要包含的模型 ID（多个用逗号分隔），或直接回车使用全部:${C.reset}`);
          const pick = await rl.question(`  > `);
          if (pick.trim()) {
            modelIds = pick.split(",").map((s) => s.trim()).filter(Boolean);
          }
        }
      } else {
        console.log(`  ${C.yellow}⚠ 接口返回了空列表${C.reset}`);
        fetchFailed = true;
      }
    } else {
      console.log(`  ${C.yellow}⚠ 接口返回 ${response.status}，无法自动获取模型${C.reset}`);
      fetchFailed = true;
    }
  } catch (err: any) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      console.log(`  ${C.yellow}⚠ 连接超时，请确认服务是否已启动${C.reset}`);
    } else {
      console.log(`  ${C.yellow}⚠ 无法连接: ${err?.message ?? err}${C.reset}`);
    }
    fetchFailed = true;
  }

  // 自动获取失败时，让用户手动输入
  if (fetchFailed || modelIds.length === 0) {
    console.log(`  ${C.dim}请手动输入模型 ID${C.reset}`);
    const manual = await rl.question(`  模型 ID (多个用逗号分隔, 如 llama3.1:8b,qwen2.5-coder:7b): `);
    modelIds = manual.split(",").map((s) => s.trim()).filter(Boolean);
  }

  if (modelIds.length === 0) {
    console.log(`  ${C.yellow}至少需要一个模型 ID${C.reset}`);
    return;
  }

  if (!modelsConfig.providers) modelsConfig.providers = {};
  modelsConfig.providers[name.trim()] = {
    baseUrl: apiBase,
    api: "openai-completions",
    apiKey: apiKey.trim() || undefined,
    models: modelIds.map((id) => ({ id })),
  };

  writeModels(modelsConfig);
  console.log(`  ${C.green}✓${C.reset} 自定义 provider "${name}" 已保存到 ~/.pi/agent/models.json${C.reset}`);
  console.log(`  ${C.dim}  地址: ${apiBase}${C.reset}`);
  console.log(`  ${C.dim}  模型: ${modelIds.join(", ")}${C.reset}`);
}

// ═══════════════════════════════════════════════════════════════
//  第二步：模型选择
// ═══════════════════════════════════════════════════════════════

async function selectModels(
  auth: Record<string, any>,
  modelsConfig: Record<string, any>
): Promise<void> {
  // 重新创建 registry 以加载新配置的 key 和自定义 provider
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const available = await modelRegistry.getAvailable();

  if (available.length === 0) {
    console.log(`\n${C.red}❌ 没有可用模型。请先配置 API key。${C.reset}`);
    return;
  }

  // 按 provider 分组
  const byProvider: Record<string, typeof available> = {};
  for (const m of available) {
    if (!byProvider[m.provider]) byProvider[m.provider] = [];
    byProvider[m.provider].push(m);
  }

  // 构建选择列表
  const choices: Array<{ index: number; label: string }> = [];
  console.log(`\n${C.bold}${C.cyan}═══ 🎯 模型选择 ═══${C.reset}\n`);
  console.log(`${C.dim}可用模型 (按 provider 分组):${C.reset}`);

  for (const [provider, models] of Object.entries(byProvider)) {
    console.log(`  ${C.bold}${provider}${C.reset}:`);
    for (const m of models) {
      choices.push({ index: choices.length + 1, label: `${provider}/${m.id}` });
      console.log(`    ${C.cyan}${String(choices.length).padStart(2)}${C.reset}) ${m.id}`);
    }
  }

  // 加载或创建配置
  let config: WorkflowConfig;
  if (existsSync(CONFIG_PATH)) {
    config = await loadConfig(CONFIG_PATH);
  } else {
    config = createDefaultConfig(choices);
  }

  const rl = readline.createInterface({ input, output });
  const stageNames = Object.keys(config.stages);

  try {
    console.log(`\n${C.bold}请为每个阶段选择模型 (输入编号，回车保持不变):${C.reset}`);

    for (let i = 0; i < stageNames.length; i++) {
      const name = stageNames[i];
      const stage = config.stages[name];
      const currentIdx = choices.findIndex((c) => c.label === stage.model);

      console.log(
        `\n${C.bold}阶段 ${i + 1}/${stageNames.length}: ${name}${C.reset}${stage.label ? ` ${C.dim}(${stage.label})${C.reset}` : ""}`
      );
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
  } finally {
    rl.close();
  }

  // 保存配置
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
  console.log(`\n${C.green}✅ 配置已保存到 ${CONFIG_PATH}${C.reset}`);

  // 展示最终配置
  console.log(`\n${C.bold}📄 最终配置:${C.reset}`);
  for (const [name, stage] of Object.entries(config.stages)) {
    console.log(
      `  ${C.cyan}${name}${C.reset}: ${C.bold}${stage.model}${C.reset}${stage.thinking ? ` (thinking: ${stage.thinking})` : ""}`
    );
  }
  console.log();
}

// ─── 工具函数 ─────────────────────────────────────────────────

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

async function countModels(
  provider: string,
  auth: Record<string, any>,
  modelsConfig: Record<string, any>
): Promise<number> {
  try {
    const authStorage = AuthStorage.create();
    const registry = ModelRegistry.create(authStorage);
    const available = await registry.getAvailable();
    return available.filter((m) => m.provider === provider).length;
  } catch {
    return 0;
  }
}

function createDefaultConfig(choices: Array<{ label: string }>): WorkflowConfig {
  const pick = (idx: number) =>
    choices[Math.min(idx, choices.length - 1)]?.label ?? choices[0]?.label ?? "unknown/model";

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
