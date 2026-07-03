import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

/** 解析后的模型引用 */
export interface ModelRef {
  provider: string;
  modelId: string;
}

/**
 * 解析 "provider/modelId" 格式的模型引用字符串。
 *
 * 格式要求: provider/modelId，两部分都不能为空。
 * 示例: "anthropic/claude-sonnet-4-20250514"
 */
export function parseModelRef(ref: string): ModelRef {
  if (!ref || typeof ref !== "string") {
    throw new Error(`模型引用格式无效: "${ref}"，应为 "provider/modelId"`);
  }

  const parts = ref.split("/");
  if (parts.length !== 2) {
    throw new Error(`模型引用格式无效: "${ref}"，缺少 "/" 分隔符`);
  }

  const [provider, modelId] = parts;

  if (!provider) {
    throw new Error(`模型引用格式无效: "${ref}"，provider 不能为空`);
  }

  if (!modelId) {
    throw new Error(`模型引用格式无效: "${ref}"，modelId 不能为空`);
  }

  return { provider, modelId };
}

/**
 * 通过 ModelRegistry 查找模型对象。
 * 找不到时返回 null。
 */
export function resolveModel(
  registry: ModelRegistry,
  ref: string
): { provider: string; id: string } | null {
  try {
    const { provider, modelId } = parseModelRef(ref);
    const model = registry.find(provider, modelId);
    if (!model) return null;
    return { provider: model.provider, id: model.id };
  } catch {
    return null;
  }
}
