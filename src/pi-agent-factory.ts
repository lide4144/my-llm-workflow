import {
  AuthStorage,
  ModelRegistry,
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { parseModelRef } from "./model-resolver.js";
import type { AgentFactory, AgentSession } from "./stage-runner.js";

/**
 * 创建生产环境的 AgentFactory，使用真实的 pi SDK。
 */
export function createPiAgentFactory(
  deps?: {
    authStorage?: AuthStorage;
    modelRegistry?: ModelRegistry;
  }
): AgentFactory {
  const authStorage = deps?.authStorage ?? AuthStorage.create();
  const modelRegistry = deps?.modelRegistry ?? ModelRegistry.create(authStorage);

  return {
    async createSession(options) {
      const { provider, modelId } = parseModelRef(options.modelRef);
      const model = modelRegistry.find(provider, modelId);

      if (!model) {
        throw new Error(
          `找不到模型: ${options.modelRef}\n` +
          `请确认已配置 ${provider} 的 API key（/login 或环境变量）。`
        );
      }

      const { session: piSession } = await createAgentSession({
        model,
        thinkingLevel: (options.thinking as any) ?? "off",
        authStorage,
        modelRegistry,
        sessionManager: SessionManager.inMemory(),
        tools: ["read", "bash", "edit", "write"],
      });

      return new PiAgentSessionWrapper(piSession);
    },
  };
}

/**
 * 包装 pi SDK 的 AgentSession，暴露简化接口。
 * 保持轻量——事件转发、不处理业务逻辑。
 */
class PiAgentSessionWrapper implements AgentSession {
  private piSession: any;
  private subscribers = new Set<(event: any) => void>();

  constructor(piSession: any) {
    this.piSession = piSession;
  }

  subscribe(fn: (event: any) => void): () => void {
    this.subscribers.add(fn);
    if (this.subscribers.size === 1) {
      // 首次订阅时，挂接到 pi session
      this.piSession.subscribe((event: any) => {
        for (const cb of this.subscribers) {
          cb(event);
        }
      });
    }
    return () => {
      this.subscribers.delete(fn);
    };
  }

  async prompt(text: string): Promise<void> {
    await this.piSession.prompt(text);
  }

  dispose(): void {
    this.subscribers.clear();
    this.piSession.dispose();
  }
}
