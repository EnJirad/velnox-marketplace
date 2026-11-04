/**
 * Context Budget Manager
 * 
 * Determines model context limits, calculates prompt budgets, and enforces
 * size constraints before API requests are sent.
 */

export interface ModelConfig {
  id: string;
  contextWindow: number;
  maxOutput: number;
  provider: string;
}

export interface ContextBudget {
  maxPromptTokens: number;
  maxCompletionTokens: number;
  safetyMargin: number;
  estimatedPromptTokens: number;
  withinBudget: boolean;
}

export interface BudgetConfig {
  defaultSafetyMargin: number;
  minCompletionTokens: number;
  maxCompletionTokens: number;
}

// Known model configurations (from provider catalogs)
export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  'gpt-6-astra': { id: 'gpt-6-astra', contextWindow: 272000, maxOutput: 32768, provider: 'tenixe' },
  'gpt-5.6-luna': { id: 'gpt-5.6-luna', contextWindow: 272000, maxOutput: 32768, provider: 'tenixe' },
  'codex-5.3': { id: 'codex-5.3', contextWindow: 272000, maxOutput: 32768, provider: 'tenixe' },
  'claude-haiku-5-5': { id: 'claude-haiku-5-5', contextWindow: 100000, maxOutput: 32768, provider: 'tenixe' },
  'claude-opus-5-5': { id: 'claude-opus-5-5', contextWindow: 1000000, maxOutput: 32768, provider: 'tenixe' },
  'claude-sonnet-5-5': { id: 'claude-sonnet-5-5', contextWindow: 1000000, maxOutput: 32768, provider: 'tenixe' },
  'deepseek-v4-flash': { id: 'deepseek-v4-flash', contextWindow: 1000000, maxOutput: 32768, provider: 'tenixe' },
  'nemotron-3-ultra': { id: 'nemotron-3-ultra', contextWindow: 1000000, maxOutput: 32768, provider: 'tenixe' },
  'gemini-4-argon': { id: 'gemini-4-argon', contextWindow: 1048576, maxOutput: 32768, provider: 'tenixe' },
  'glm-5.3': { id: 'glm-5.3', contextWindow: 1000000, maxOutput: 32768, provider: 'tenixe' },
};

const DEFAULT_CONFIG: BudgetConfig = {
  defaultSafetyMargin: 0.15, // 15% safety margin
  minCompletionTokens: 4096,
  maxCompletionTokens: 32768,
};

export class ContextBudgetManager {
  private config: BudgetConfig;
  private currentModel: ModelConfig;

  constructor(modelId: string, config: Partial<BudgetConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentModel = MODEL_CONFIGS[modelId] || MODEL_CONFIGS['claude-haiku-5-5'];
  }

  setModel(modelId: string): void {
    this.currentModel = MODEL_CONFIGS[modelId] || this.currentModel;
  }

  getModel(): ModelConfig {
    return this.currentModel;
  }

  /**
   * Calculate the maximum allowed prompt tokens given the model's context window
   * and desired completion tokens.
   */
  calculateBudget(desiredCompletionTokens?: number): ContextBudget {
    const safetyTokens = Math.floor(this.currentModel.contextWindow * this.config.defaultSafetyMargin);
    // Handle undefined, 0, or negative as "use minimum"
    const effectiveCompletionTokens = (desiredCompletionTokens !== undefined && desiredCompletionTokens > 0)
      ? desiredCompletionTokens
      : this.config.minCompletionTokens;
    const completionTokens = Math.min(
      Math.max(effectiveCompletionTokens, this.config.minCompletionTokens),
      this.config.maxCompletionTokens
    );
    
    const maxPromptTokens = this.currentModel.contextWindow - completionTokens - safetyTokens;
    
    return {
      maxPromptTokens,
      maxCompletionTokens: completionTokens,
      safetyMargin: safetyTokens,
      estimatedPromptTokens: 0,
      withinBudget: true,
    };
  }

  /**
   * Estimate token count from text (rough approximation: 1 token ≈ 4 chars for English)
   * For more accurate counting, a proper tokenizer should be used.
   */
  estimateTokens(text: string): number {
    // Rough estimation: ~4 chars per token for mixed content
    return Math.ceil(text.length / 4);
  }

  /**
   * Check if a request fits within the budget
   */
  checkBudget(promptText: string, desiredCompletionTokens?: number): ContextBudget {
    const budget = this.calculateBudget(desiredCompletionTokens);
    const estimatedTokens = this.estimateTokens(promptText);
    
    return {
      ...budget,
      estimatedPromptTokens: estimatedTokens,
      withinBudget: estimatedTokens <= budget.maxPromptTokens,
    };
  }

  /**
   * Get the maximum prompt size for the current model
   */
  getMaxPromptTokens(desiredCompletionTokens?: number): number {
    return this.calculateBudget(desiredCompletionTokens).maxPromptTokens;
  }
}

/**
 * Provider-specific gateway limits (observed from task-controls)
 * These are the ACTUAL limits enforced by the API gateway
 */
export const GATEWAY_LIMITS: Record<string, { contextWindow: number; maxOutput: number }> = {
  'tenixe': { contextWindow: 200000, maxOutput: 32768 }, // api.tenixe.com
  'aiunlimit': { contextWindow: 200000, maxOutput: 32768 }, // aiunlimit.thirx.com
  'default': { contextWindow: 100000, maxOutput: 32768 },
};

export function getEffectiveLimit(provider: string): { contextWindow: number; maxOutput: number } {
  return GATEWAY_LIMITS[provider] || GATEWAY_LIMITS['default'];
}
