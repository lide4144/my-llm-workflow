# my-llm-workflow

多 Agent LLM 工作流编排器 — 基于 [pi coding agent](https://pi.dev) SDK。

将软件开发流程拆解为 4 个阶段，每个阶段由不同的 AI 模型独立执行，通过多轮交互和阶段间产物流转实现完整的自动化开发链路。

## 工作流

| # | 阶段 | 默认模型 | 说明 |
|---|------|---------|------|
| 1 | `brainstorming` | Gemini 3.1 Pro | 需求探讨、方案设计、多轮对话 |
| 2 | `writing-plans` | GLM 5.2 | 制定实施计划、设计测试策略 |
| 3 | `executing-plans` | DeepSeek V4 Flash | 编码实现、编写测试 |
| 4 | `verification` | GPT-5.5 | 代码审查、E2E 视觉验证 |

### 特性

- **多 Agent 隔离** — 每阶段使用独立 session + 可配置的不同模型
- **多轮交互** — brainstorming / writing-plans 阶段支持对话，agent 问问题、用户回答、再继续
- **自动化测试支持** — `--answers` 文件模式，可预设多轮回答自动跑完交互阶段
- **E2E 视觉验证** — verification 阶段可配置 Playwright 截图，agent 用 `read` 工具亲眼检查页面渲染
- **实时进度显示** — 管道图显示所有阶段状态 + 计时 + 工具调用日志
- **模型可配置** — 通过 `workflow.config.json` 或 `--setup` 向导配置各阶段模型

## 快速开始

```bash
# 安装依赖
npm install

# 查看帮助
npm start -- --help

# 运行工作流
npm start -- "做一个番茄钟 CLI 工具"
```

### 配置 API Key

工作流依赖 pi 的认证系统。已配置的 provider 可通过以下方式查看：

```bash
# 交互式配置向导 — 选模型、配 Key、添加自定义 provider
npm start -- --setup
```

支持 30+ 内置 provider（Anthropic、OpenAI、Google Gemini、DeepSeek 等），也支持添加自定义 OpenAI 兼容服务（Ollama、vLLM、LM Studio）。

## 多轮交互

`brainstorming` 和 `writing-plans` 阶段支持多轮对话。agent 输出后会暂停等待用户输入：

```
工作流管道
  >> brainstorming 12s  (Gemini 3.1 Pro)
  .. writing-plans      (GLM 5.2)
  -----------------------------------

正在使用 brainstorming 技能...
先确认核心玩法范围：2-4人对战还是多人混战？

  ✎ 你的补充 (回车结束):
```

### 自动化：答案文件

用 `--answers` 提供预设回答，自动完成多轮对话：

```bash
# 答案文件 b_answers.txt
echo '2-4人对战
最后存活的蛇获胜
---
在现有基础上开发
---
直接输出设计方案' > b_answers.txt

# 运行
npm start -- --project myapp --answers b_answers.txt "做一个贪吃蛇游戏"
```

答案用 `---` 分隔，每段为 agent 一问的回答。文件读取完毕后回退到键盘输入。

## 结构化输出

使用 `--project <name>` 将所有产出归入独立目录：

```
output_projects/<name>/
├── brainstorming/       ← 设计文档
├── writing-plans/       ← 计划文档 + plans/
├── executing-plans/     ← 实现记录
├── verification/        ← 验证报告 + screenshots/
```

## 配置文件

编辑 `workflow.config.json` 自定义各阶段模型和参数：

```json
{
  "stages": {
    "brainstorming": {
      "model": "My-Gemini/gemini-3.1-pro-preview",
      "thinking": "high",
      "interactive": true,
      "onFailure": "stop"
    },
    "verification": {
      "model": "openai-codex/gpt-5.5",
      "e2e": {
        "devCommand": "npm run dev",
        "baseUrl": "http://localhost:5173",
        "viewport": { "width": 1280, "height": 720 },
        "waitMs": 3000
      }
    }
  }
}
```

### E2E 视觉验证

在 verification 阶段配置 `e2e` 字段后，agent 会：

1. 启动 dev server
2. 执行 Playwright 测试（或手动截图）
3. 用 `read` 工具查看每张截图
4. 检查页面是否白屏、渲染错误、布局异常

### 配置向导

```bash
npm start -- --setup
```

交互式管理 Provider（新增 API Key、添加 Ollama 等自定义服务），然后为每个阶段选择模型。

## 命令参考

```bash
npm start -- "项目描述"                    # 运行完整工作流
npm start -- --project demo "项目描述"      # 输出到 output_projects/demo/
npm start -- --answers ans.txt "项目描述"   # 用答案文件自动化
npm start -- --from brainstorming --to brainstorming "项目"  # 只跑 brainstorming
npm start -- --setup                       # 交互式配置向导
npm start -- --help                        # 帮助
```

## 项目结构

```
my-llm-workflow/
├── src/
│   ├── cli.ts                 ← CLI 入口 + 交互逻辑
│   ├── config.ts              ← 配置加载与校验
│   ├── config-wizard.ts       ← 交互式 Provider/模型配置向导
│   ├── model-resolver.ts      ← 模型引用解析
│   ├── artifact-store.ts      ← 产物文件管理
│   ├── stage-runner.ts        ← 单阶段执行器
│   ├── orchestrator.ts        ← 工作流编排器
│   ├── pi-agent-factory.ts    ← pi SDK 包装
│   └── e2e-screenshot.mjs    ← Playwright 截图工具
├── test/                      ← 37 个测试
├── workflow.config.json       ← 默认配置
└── vitest.config.ts
```

## 开发

```bash
npm test          # 运行测试 (37 tests)
npm test:watch    # 监听模式
npm run build     # TypeScript 编译
```
