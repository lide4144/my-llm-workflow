import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** 单条产物的元信息 */
export interface ArtifactMeta {
  stage: string;
  fileName: string;
  path: string;
}

/** 保存产物的参数 */
export interface SaveArtifactOptions {
  outputDir: string;
  stage: string;
  fileName: string;
  content: string;
}

/**
 * 保存一条产物到 outputDir/stageName/ 下。
 * 目录不存在时自动创建。
 */
export async function saveArtifact(options: SaveArtifactOptions): Promise<ArtifactMeta> {
  const stageDir = join(options.outputDir, options.stage);
  await mkdir(stageDir, { recursive: true });

  const filePath = join(stageDir, options.fileName);
  await writeFile(filePath, options.content, "utf-8");

  return {
    stage: options.stage,
    fileName: options.fileName,
    path: relative(options.outputDir, filePath).split(sep).join("/"),
  };
}

/**
 * 列出指定 stage 的所有产物。
 * 目录不存在时返回空数组。
 */
export async function listArtifacts(baseDir: string, stage: string): Promise<ArtifactMeta[]> {
  const stageDir = join(baseDir, stage);

  if (!existsSync(stageDir)) {
    return [];
  }

  const entries = await readdir(stageDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile());

  return files.map((f) => ({
    stage,
    fileName: f.name,
    path: join(stage, f.name).split(sep).join("/"),
  }));
}

/**
 * 读取指定产物的内容。
 */
export async function readArtifact(baseDir: string, stage: string, fileName: string): Promise<string> {
  const filePath = join(baseDir, stage, fileName);
  return await readFile(filePath, "utf-8");
}
