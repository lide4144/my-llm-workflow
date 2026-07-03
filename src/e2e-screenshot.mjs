#!/usr/bin/env node
/**
 * E2E 截图工具 — 被验证 agent 通过 bash 调用
 *
 * 用法:
 *   node src/e2e-screenshot.mjs \
 *     --base-url http://localhost:5173 \
 *     --paths /,/about,/login \
 *     --output screenshots \
 *     --viewport 1280x720 \
 *     --wait 2000
 *
 * 功能:
 *   1. 自动安装 Playwright (首次运行)
 *   2. 启动 headless 浏览器
 *   3. 截取指定页面的截图
 *   4. 保存到输出目录
 *   5. 打印截图路径供 agent 用 read 查看
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

// ─── 参数解析 ─────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (flag: string, def?: string): string => {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : def ?? "";
};

const BASE_URL = getArg("--base-url", "").replace(/\/+$/, "");
const PATHS_STR = getArg("--paths", "");
const OUTPUT_DIR = resolve(getArg("--output", "screenshots"));
const VIEWPORT_STR = getArg("--viewport", "1280x720");
const WAIT_MS = parseInt(getArg("--wait", "2000"), 10);

if (!BASE_URL || !PATHS_STR) {
  console.error("用法: node e2e-screenshot.mjs --base-url <url> --paths <path1,path2,...>");
  process.exit(1);
}

const PATHS = PATHS_STR.split(",").map((s) => s.trim()).filter(Boolean);
const [VIEWPORT_W, VIEWPORT_H] = VIEWPORT_STR.split("x").map(Number);

// ─── 确保 Playwright 可用 ────────────────────────────────────

function ensurePlaywright(): string {
  // 尝试找 playwright 模块
  try {
    const pwPath = require.resolve("playwright", { paths: [process.cwd()] });
    return pwPath;
  } catch {
    // 没安装，自动安装
    console.error("⏳ 正在安装 Playwright (首次运行需要)...");
    execSync("npm install --no-save playwright 2>&1", {
      cwd: process.cwd(),
      stdio: "pipe",
      timeout: 120_000,
    });
    // 安装 Chromium 浏览器
    console.error("⏳ 正在安装 Chromium 浏览器...");
    execSync("npx playwright install chromium 2>&1", {
      cwd: process.cwd(),
      stdio: "pipe",
      timeout: 120_000,
    });
    return require.resolve("playwright", { paths: [process.cwd()] });
  }
}

// ─── 截图 ─────────────────────────────────────────────────────

async function run() {
  ensurePlaywright();
  const { chromium } = await import("playwright");

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_W || 1280, height: VIEWPORT_H || 720 },
    deviceScaleFactor: 1,
  });

  const results: Array<{ path: string; url: string; status: string; error?: string }> = [];

  for (const pagePath of PATHS) {
    const url = `${BASE_URL}${pagePath}`;
    const page = await context.newPage();
    const fileName = (pagePath === "/" ? "index" : pagePath.replace(/^\//, "").replace(/\//g, "-")) + ".png";
    const filePath = join(OUTPUT_DIR, fileName);

    try {
      const resp = await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 15000,
      });

      // 额外等待，确保 JS 渲染完成
      await page.waitForTimeout(WAIT_MS);

      await page.screenshot({ path: filePath, fullPage: false });

      results.push({
        path: resolve(filePath),
        url,
        status: `${resp?.status() ?? "unknown"} ${resp?.ok() ? "OK" : "ERROR"}`,
      });

      console.error(`✓ ${url} → ${fileName} (${resp?.status() ?? "?"})`);
    } catch (err: any) {
      // 即使页面加载失败也截图（可能是白屏）
      try {
        await page.screenshot({ path: filePath, fullPage: false });
      } catch { /* ignore */ }

      results.push({
        path: resolve(filePath),
        url,
        status: `ERROR: ${err?.message ?? err}`,
        error: err?.message,
      });

      console.error(`✗ ${url} → ${fileName} (${err?.message?.slice(0, 60) ?? "?"})`);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  // 输出结果 JSON — agent 可以解析
  const output = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    viewport: `${VIEWPORT_W}x${VIEWPORT_H}`,
    results,
  };

  const resultPath = join(OUTPUT_DIR, "report.json");
  writeFileSync(resultPath, JSON.stringify(output, null, 2));

  // stdout 只输出路径列表，供 agent 的 read 工具使用
  for (const r of results) {
    console.log(`SCREENSHOT:${r.path}:${r.status}`);
  }
  console.log(`REPORT:${resultPath}`);
}

run().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
