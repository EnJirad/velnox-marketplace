/**
 * AI Office Context Manager
 * 
 * Main integration layer that orchestrates context budget management,
 * intelligent compaction, and task-based context selection.
 * This replaces the naive "send everything" approach.
 */

import { ContextBudgetManager, ContextBudget, ModelConfig, getEffectiveLimit } from './context-budget';
import { ContextCompactor, Message, CompactionOptions, emergencyCompact } from './context-compaction';
import { TaskContextSelector, TaskContext, ContextSelectionOptions, SelectionResult, CONTEXT_PROFILES } from './task-context-selector';

export interface AIOfficeConfig {
  modelId: string;
  provider: string;
  taskId?: string;
  phase?: 'planning' | 'implementation' | 'qa' | 'recovery';
  budgetConfig?: {
    safetyMargin?: number;
    minCompletionTokens?: number;
    maxCompletionTokens?: number;
  };
  compactionOptions?: Partial<CompactionOptions>;
}

export interface ContextManagerState {
  taskContext: TaskContext;
  messageHistory: Message[];
  currentInstruction: string;
  turnCount: number;
  lastCompactionTurn: number;
  totalTokensSaved: number;
}

export interface BuildRequestResult {
  messages: Message[];
  budget: ContextBudget;
  metadata: {
    originalMessages: number;
    finalMessages: number;
    originalTokens: number;
    finalTokens: number;
    compactionApplied: boolean;
    selectionSummary: string;
    withinBudget: boolean;
  };
}

export class AIOfficeContextManager {
  private budgetManager: ContextBudgetManager;
  private compactor: ContextCompactor;
  private selector: TaskContextSelector;
  private state: ContextManagerState;
  private config: AIOfficeConfig;

  constructor(config: AIOfficeConfig) {
    this.config = config;
    
    // Initialize with provider-specific limits
    const gatewayLimit = getEffectiveLimit(config.provider);
    const modelConfig: ModelConfig = {
      id: config.modelId,
      contextWindow: gatewayLimit.contextWindow,
      maxOutput: gatewayLimit.maxOutput,
      provider: config.provider,
    };
    
    // Override the budget manager's model config
    this.budgetManager = new ContextBudgetManager(config.modelId, config.budgetConfig);
    // Manually set the effective model config based on gateway
    (this.budgetManager as any).currentModel = modelConfig;
    
    this.compactor = new ContextCompactor(this.budgetManager, config.compactionOptions);
    this.selector = new TaskContextSelector(this.budgetManager);
    
    this.state = {
      taskContext: {
        taskId: config.taskId || 'unknown',
        phase: config.phase || 'planning',
        currentStep: 'Starting',
        completedSteps: [],
        remainingSteps: [],
        changedFiles: [],
        importantDecisions: [],
        failedAttempts: [],
        testResults: [],
      },
      messageHistory: [],
      currentInstruction: '',
      turnCount: 0,
      lastCompactionTurn: 0,
      totalTokensSaved: 0,
    };
  }

  /**
   * Update the task context (called at phase transitions)
   */
  updateTaskContext(updates: Partial<TaskContext>): void {
    this.state.taskContext = { ...this.state.taskContext, ...updates };
  }

  /**
   * Add a message to history
   */
  addMessage(message: Message): void {
    this.state.messageHistory.push(message);
    this.state.turnCount++;
  }

  /**
   * Set the current user instruction
   */
  setCurrentInstruction(instruction: string): void {
    this.state.currentInstruction = instruction;
  }

  /**
   * Build the optimized request for the API
   */
  async buildRequest(
    options: Partial<ContextSelectionOptions> = {}
  ): Promise<BuildRequestResult> {
    const profile = CONTEXT_PROFILES[this.state.taskContext.phase] || CONTEXT_PROFILES.planning;
    const mergedOptions: ContextSelectionOptions = {
      ...profile,
      ...options,
      maxTokens: options.maxTokens || this.budgetManager.getMaxPromptTokens(),
    };

    const originalMessageCount = this.state.messageHistory.length;
    const originalTokens = this.estimateTotalTokens(this.state.messageHistory);

    // Build context using task-based selection
    const selection = await this.selector.buildContext(
      this.state.taskContext,
      this.state.currentInstruction,
      this.state.messageHistory,
      mergedOptions
    );

    let finalMessages = selection.messages;
    let compactionApplied = false;
    let finalTokens = selection.budget.estimatedPromptTokens;

    // Apply compaction if still over budget
    if (!selection.budget.withinBudget) {
      const compacted = this.compactor.compact(finalMessages);
      finalMessages = compacted.messages;
      finalTokens = compacted.compactedTokens;
      compactionApplied = true;
      this.state.lastCompactionTurn = this.state.turnCount;
      this.state.totalTokensSaved += compacted.originalTokens - compacted.compactedTokens;
    }

    // Emergency fallback if still over budget
    if (finalTokens > selection.budget.maxPromptTokens) {
      finalMessages = emergencyCompact(finalMessages, selection.budget.maxPromptTokens);
      finalTokens = this.estimateTotalTokens(finalMessages);
      compactionApplied = true;
    }

    const result: BuildRequestResult = {
      messages: finalMessages,
      budget: { ...selection.budget, estimatedPromptTokens: finalTokens, withinBudget: finalTokens <= selection.budget.maxPromptTokens },
      metadata: {
        originalMessages: originalMessageCount,
        finalMessages: finalMessages.length,
        originalTokens,
        finalTokens,
        compactionApplied,
        selectionSummary: selection.selectionSummary,
        withinBudget: finalTokens <= selection.budget.maxPromptTokens,
      },
    };

    return result;
  }

  /**
   * Get current state for persistence/recovery
   */
  getState(): ContextManagerState {
    return { ...this.state };
  }

  /**
   * Restore state from persistence
   */
  restoreState(state: ContextManagerState): void {
    this.state = { ...state };
  }

  /**
   * Get a summary for logging/debugging
   */
  getSummary(): string {
    return `Task: ${this.state.taskContext.taskId} | Phase: ${this.state.taskContext.phase} | Turns: ${this.state.turnCount} | History: ${this.state.messageHistory.length} msgs | Saved: ${this.state.totalTokensSaved} tokens`;
  }

  private estimateTotalTokens(messages: Message[]): number {
    return messages.reduce((sum, msg) => {
      let tokens = Math.ceil(msg.content.length / 4);
      if (msg.tool_calls) {
        tokens += msg.tool_calls.reduce((t, tc) => t + Math.ceil(JSON.stringify(tc).length / 4), 0);
      }
      return sum + tokens;
    }, 0);
  }

  /**
   * Clear history (for new task)
   */
  clearHistory(): void {
    this.state.messageHistory = [];
    this.state.turnCount = 0;
    this.state.currentInstruction = '';
    this.selector.clearCache();
  }
}

/**
 * Factory function to create a context manager for the current AI Office setup
 */
export function createAIOfficeContextManager(
  modelId: string = 'claude-haiku-5-5',
  provider: string = 'tenixe',
  taskId?: string
): AIOfficeContextManager {
  return new AIOfficeContextManager({
    modelId,
    provider,
    taskId,
    phase: 'planning',
    budgetConfig: {
      safetyMargin: 0.15,
      minCompletionTokens: 4096,
      maxCompletionTokens: 32768,
    },
    compactionOptions: {
      preserveSystem: true,
      preserveCurrentUser: true,
      preserveTaskPlan: true,
      preserveRecentTurns: 5,
      preserveToolCalls: true,
      maxToolOutputChars: 2000,
      summarizeOldTurns: true,
    },
  });
}

/**
 * Quick budget check without full selection
 */
export function quickBudgetCheck(
  messages: Message[],
  modelId: string = 'claude-haiku-5-5',
  provider: string = 'tenixe'
): { withinBudget: boolean; estimatedTokens: number; maxAllowed: number } {
  const manager = new ContextBudgetManager(modelId);
  const gatewayLimit = getEffectiveLimit(provider);
  (manager as any).currentModel = {
    id: modelId,
    contextWindow: gatewayLimit.contextWindow,
    maxOutput: gatewayLimit.maxOutput,
    provider,
  };
  
  const estimatedTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
  const budget = manager.calculateBudget();
  
  return {
    withinBudget: estimatedTokens <= budget.maxPromptTokens,
    estimatedTokens,
    maxAllowed: budget.maxPromptTokens,
  };
}
