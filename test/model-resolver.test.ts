import { describe, it, expect } from "vitest";
import { ModelRegistry, AuthStorage } from "@earendil-works/pi-coding-agent";
import { parseModelRef, resolveModel } from "../src/model-resolver.js";

describe("parseModelRef", () => {
  it('解析 "provider/modelId" 格式', () => {
    const result = parseModelRef("anthropic/claude-sonnet-4-20250514");
    expect(result).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
    });
  });

  it('解析 "openai/gpt-4o" 格式', () => {
    const result = parseModelRef("openai/gpt-4o");
    expect(result).toEqual({ provider: "openai", modelId: "gpt-4o" });
  });

  it("缺少 / 分隔符时抛出明确错误", () => {
    expect(() => parseModelRef("just-a-model-name")).toThrow(/格式|format|\//i);
  });

  it("provider 为空时抛出错误", () => {
    expect(() => parseModelRef("/gpt-4o")).toThrow(/provider|格式|format/i);
  });

  it("modelId 为空时抛出错误", () => {
    expect(() => parseModelRef("openai/")).toThrow(/model|格式|format/i);
  });

  it("空字符串时抛出错误", () => {
    expect(() => parseModelRef("")).toThrow(/格式|format/i);
  });
});

describe("resolveModel", () => {
  const auth = AuthStorage.create();
  const registry = ModelRegistry.inMemory(auth);

  it("通过已注册的模型 reference 找到 Model 对象", () => {
    const model = resolveModel(registry, "anthropic/claude-sonnet-4-20250514");
    expect(model).not.toBeNull();
    expect(model!.provider).toBe("anthropic");
    expect(model!.id).toBe("claude-sonnet-4-20250514");
  });

  it("不存在的模型返回 null", () => {
    const model = resolveModel(registry, "anthropic/this-model-does-not-exist-12345");
    expect(model).toBeNull();
  });

  it("不存在的 provider 返回 null", () => {
    const model = resolveModel(registry, "nonexistent-provider/some-model");
    expect(model).toBeNull();
  });
});
