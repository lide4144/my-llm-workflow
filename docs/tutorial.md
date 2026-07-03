# 上手指南：用 my-llm-workflow 完成第一个项目

本教程会带你从零开始，完整跑一遍工作流 —— 做一个番茄钟 CLI 工具。

---

## 准备工作

```bash
# 1. 克隆项目
git clone https://github.com/lide4144/my-llm-workflow.git
cd my-llm-workflow

# 2. 安装依赖
npm install

# 3. 确认能跑
npm start -- --help
```

如果看到帮助菜单，环境就绪。

---

## 第一步：配置模型和 API Key

工作流默认配置了 4 个模型，但你的电脑上不一定有这些 provider 的 API key。

### 查看已有 provider

```bash
npm start -- --setup
```

你会看到类似输出：

```
🔧 my-llm-workflow 配置向导

═══ 📦 Provider 管理 ═══

已配置 key:
  ✓ openai-codex  (4 个模型)
  ✓ opencode-go   (13 个模型)

可配置的内置 provider:
  主流 API:
    1) anthropic
    2) openai
    3) google
    ...
```

> **如果你看到 `已配置 key` 中有 provider**，可以直接跳到第二步。
>
> **如果没有任何已配置的 provider**，选一个编号输入 API key。比如选 `1` (anthropic)，输入 `sk-ant-...`。或者用环境变量：`export ANTHROPIC_API_KEY=sk-...`。

### 选 35 号完成配置

配置好 key 后，选 35 号进入模型选择界面。为每个阶段选一个可用的模型：

```
阶段 1/4: brainstorming (需求探讨与方案设计)
  当前: My-Gemini/gemini-3.1-pro-preview
  可选:
   1) openai-codex/gpt-5.4
   2) opencode-go/deepseek-v4-pro
   ...
  选择 (1-17, 回车不变):
```

也可以直接修改 `workflow.config.json`：

```json
{
  "brainstorming": { "model": "opencode-go/kimi-k2.7-code" },
  "writing-plans": { "model": "opencode-go/qwen3.7-max" },
  "executing-plans": { "model": "opencode-go/deepseek-v4-flash" },
  "verification":  { "model": "openai-codex/gpt-5.5" }
}
```

---

## 第二步：跑第一个项目（交互模式）

```bash
npm start -- --project tomato-cli "做一个番茄钟 CLI 工具"
```

你会看到：

```
工作流管道
  >> brainstorming 0s  (配置好的模型)
  .. writing-plans
  .. executing-plans
  .. verification
  -----------------------------------
```

### 和 brainstorming Agent 对话

agent 开始输出，然后停下来等你回答：

```
正在使用 brainstorming 技能...

**第一个问题：这个番茄钟的核心功能有哪些？**

A. 基础的 25 分钟计时 + 休息提醒
B. 包含任务管理（添加、完成、统计）
C. 支持多项目并行

  ✎ 你的补充 (回车结束):
```

**你的回答**：输入 `A` 或 `B` 或自定义内容，回车。

Agent 收到后继续往下推进，可能会接着问下一个问题。你可以：

- **打字回答** → agent 继续对话
- **直接回车** → 结束本轮，进入下一阶段

反复几轮后，brainstorming 阶段完成，自动进入 writing-plans。

### 完整对话示意

```
你: A，基础的 25 分钟计时
Agent: 好的，那数据需要持久化吗？比如保存历史记录。
你: 要，用 JSON 文件存就行
Agent: 明白了。设计方案如下...
    ...
你: (直接回车 → brainstorming 结束)

>> writing-plans ...
Agent: 我根据设计方案制定实施计划...
    ...
你: (直接回车 → 进入编码阶段)
```

> **注意**：`executing-plans` 和 `verification` 阶段是非交互的，会全自动运行。
> 编码阶段可能比较久 (5-15 分钟)，因为 agent 要写代码、跑测试、修改。

---

## 第三步：用答案文件自动化

如果你不想守在终端前打字，可以预先准备回答。

### 创建答案文件

根据你对项目的预期，写好可能的问题回答：

```bash
cat > my_answers.txt << 'EOF'
A，基础番茄钟，25分钟计时 + 休息提醒
用 JSON 文件存储历史记录
支持命令行参数自定义时长
可以了，直接输出设计方案
---
用 Inline Execution 按任务顺序执行
开始实施
EOF
```

> 每个答案用 `---` 分隔。空的或 `#` 开头的行会被忽略。

### 运行

```bash
npm start -- --project tomato-cli --answers my_answers.txt "做一个番茄钟 CLI 工具"
```

工作流会从答案文件逐行读取回答，文件读完了退回到键盘输入。

### 观察答案消费过程

```
[45s] [答案: A，基础番茄钟，25分钟计时 + 休息提醒]
[90s] [答案: 用 JSON 文件存储历史记录]
...
```

### 小技巧

- **先少写几个答案**，跑一次看看 agent 问了几个问题
- **记下问题数**，下次补全答案文件
- 也可以写一个通用答案模版，不同项目微调

---

## 第四步：E2E 视觉验证（有前端时）

如果你的项目包含前端页面，可以配置 visual E2E 验证。

### 配置 verification 阶段

在 `workflow.config.json` 的 verification 阶段加上 `e2e` 字段：

```json
{
  "verification": {
    "model": "openai-codex/gpt-5.5",
    "e2e": {
      "devCommand": "cd output_projects/todo-app/code/app && npm run dev",
      "baseUrl": "http://localhost:5173",
      "viewport": { "width": 1280, "height": 720 },
      "waitMs": 3000
    }
  }
}
```

### Agent 的行为

1. 启动 dev server
2. 运行 Playwright E2E 测试（如果 executing-plans 阶段写了）
3. 如果没有测试，手动截图
4. 用 `read` 工具查看每张截图
5. 报告页面渲染状态

```
[120s] ⚙ cd output_projects/todo-app/code/app && npm run dev
[122s] OK
[125s] ⚙ npx playwright test tests/e2e/
[130s] OK
[131s] ⚙ read screenshots/index.png
       → 模型"看到"了截图，判断页面是否正常
```

---

## 第五步：理解产出物

运行完成后，输出目录结构如下（如果用 `--project`）：

```
output_projects/tomato-cli/
├── brainstorming/
│   └── stage-brainstorming-output.md    ← 设计方案
├── writing-plans/
│   ├── stage-writing-plans-output.md    ← 计划说明
│   └── plans/
│       └── 2026-07-04-tomato-cli.md     ← 实施计划
├── executing-plans/
│   └── stage-executing-plans-output.md  ← 实现记录
└── verification/
    └── stage-verification-output.md     ← 验证报告
```

项目代码会被 agent 创建在 `output_projects/tomato-cli/code/` 下。

---

## 排错指南

### 模型不可用

```
错误: 找不到模型: anthropic/claude-sonnet-4-20250514
请确认已配置 anthropic 的 API key
```

**解决**：运行 `npm start -- --setup` 配置 key，或用 `--override` 临时换模型：

```bash
npm start -- --override brainstorming:opencode-go/kimi-k2.7-code "项目"
```

### 答案文件失效

如果答案文件中的回答已经消费完，工作流会自动回到键盘输入模式，不会卡住。

### 阶段执行太久

- `executing-plans` 阶段最耗时（可能 10 分钟以上）
- 观察工具调用日志 `[120s] ⚙ bash ...` 了解进度
- 如果实在等不及，Ctrl+C 中断，下次用 `--from` 继续：

```bash
npm start -- --from verification "项目描述"
```

### 测试

```bash
npm test
# 37 tests passing
```
