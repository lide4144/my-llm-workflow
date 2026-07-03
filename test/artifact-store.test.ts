import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  saveArtifact,
  listArtifacts,
  readArtifact,
  type ArtifactMeta,
} from "../src/artifact-store.js";

// ─── Helpers ────────────────────────────────────────────────────

let baseDir: string;

beforeEach(() => {
  baseDir = join(tmpdir(), `mw-test-artifact-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

// ─── Tests ───────────────────────────────────────────────────────

describe("saveArtifact", () => {
  it("保存产物到 outputDir/stageName/ 目录下", async () => {
    const meta = await saveArtifact({
      outputDir: baseDir,
      stage: "brainstorming",
      fileName: "design.md",
      content: "# 设计文档",
    });

    // 检查返回的元信息
    expect(meta.stage).toBe("brainstorming");
    expect(meta.fileName).toBe("design.md");
    expect(meta.path).toContain("brainstorming/design.md");

    // 检查文件确实写入了
    const fullPath = join(baseDir, "brainstorming", "design.md");
    expect(existsSync(fullPath)).toBe(true);
    expect(readFileSync(fullPath, "utf-8")).toBe("# 设计文档");
  });

  it("产物目录不存在时自动创建", async () => {
    const meta = await saveArtifact({
      outputDir: baseDir,
      stage: "unknown-stage",
      fileName: "result.json",
      content: JSON.stringify({ ok: true }),
    });

    expect(existsSync(join(baseDir, "unknown-stage", "result.json"))).toBe(true);
  });
});

describe("listArtifacts", () => {
  it("列出指定 stage 的所有产物", async () => {
    await saveArtifact({ outputDir: baseDir, stage: "brainstorming", fileName: "a.md", content: "a" });
    await saveArtifact({ outputDir: baseDir, stage: "brainstorming", fileName: "b.md", content: "b" });

    const files = await listArtifacts(baseDir, "brainstorming");

    expect(files).toHaveLength(2);
    expect(files.map((f) => f.fileName).sort()).toEqual(["a.md", "b.md"]);
  });

  it("stage 没有产物时返回空数组", async () => {
    const files = await listArtifacts(baseDir, "nonexistent");
    expect(files).toEqual([]);
  });
});

describe("readArtifact", () => {
  it("读取指定产物内容", async () => {
    await saveArtifact({ outputDir: baseDir, stage: "brainstorming", fileName: "hello.txt", content: "world" });

    const content = await readArtifact(baseDir, "brainstorming", "hello.txt");
    expect(content).toBe("world");
  });

  it("产物不存在时抛出明确错误", async () => {
    await expect(
      readArtifact(baseDir, "brainstorming", "nope.txt")
    ).rejects.toThrow(/not found|不存在|ENOENT/i);
  });
});
