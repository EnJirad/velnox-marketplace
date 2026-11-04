/**
 * Intelligent Context Compaction
 * 
 * Reduces prompt size by removing redundant content while preserving
 * essential information for valid tool-call sequences.
 */

import { ContextBudgetManager, ContextBudget } from './context-budget';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface CompactionOptions {
  preserveSystem: boolean;
  preserveCurrentUser: boolean;
  preserveTaskPlan: boolean;
  preserveRecentTurns: number;
  preserveToolCalls: boolean;
  maxToolOutputChars: number;
  summarizeOldTurns: boolean;
}

export interface CompactionResult {
  messages: Message[];
  originalTokens: number;
  compactedTokens: number;
  removedCount: number;
  summary: string;
  budget: ContextBudget;
}

const DEFAULT_OPTIONS: CompactionOptions = {
  preserveSystem: true,
  preserveCurrentUser: true,
  preserveTaskPlan: true,
  preserveRecentTurns: 5,
  preserveToolCalls: true,
  maxToolOutputChars: 2000,
  summarizeOldTurns: true,
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function extractTaskPlan(messages: Message[]): string | null {
  // Look for task plan markers in recent messages
  const planMarkers = ['TASK BRIEF', '## STEPS', '## ACCEPTANCE CRITERIA', 'APPROACH:', 'STEPS:'];
  
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i].content;
    if (planMarkers.some(marker => content.includes(marker))) {
      // Return the relevant section
      const lines = content.split('\n');
      const startIdx = lines.findIndex(l => planMarkers.some(m => l.includes(m)));
      if (startIdx >= 0) {
        return lines.slice(startIdx, startIdx + 50).join('\n');
      }
    }
  }
  return null;
}

function truncateToolOutput(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  
  // Try to keep beginning and end
  const half = Math.floor(maxChars / 2);
  const start = content.slice(0, half);
  const end = content.slice(-half);
  return `${start}\n\n... [TRUNCATED: ${content.length - maxChars} chars removed] ...\n\n${end}`;
}

function createTurnSummary(messages: Message[], startIdx: number, endIdx: number): string {
  const turns = messages.slice(startIdx, endIdx + 1);
  let summary = `## Summary of ${turns.length} previous turns\n\n`;
  
  for (const msg of turns) {
    if (msg.role === 'user') {
      summary += `- **User**: ${msg.content.slice(0, 100)}...\n`;
    } else if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        summary += `- **Assistant**: Called ${msg.tool_calls.map(tc => tc.function.name).join(', ')}\n`;
      } else {
        summary += `- **Assistant**: ${msg.content.slice(0, 100)}...\n`;
      }
    } else if (msg.role === 'tool') {
      summary += `- **Tool result (${msg.name})**: ${msg.content.slice(0, 80)}...\n`;
    }
  }
  
  return summary;
}

export class ContextCompactor {
  private budgetManager: ContextBudgetManager;
  private options: CompactionOptions;

  constructor(budgetManager: ContextBudgetManager, options: Partial<CompactionOptions> = {}) {
    this.budgetManager = budgetManager;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Compact a message array to fit within token budget
   */
  compact(messages: Message[], desiredCompletionTokens?: number): CompactionResult {
    const originalTokens = this.estimateTotalTokens(messages);
    const budget = this.budgetManager.calculateBudget(desiredCompletionTokens);
    
    // Always apply tool output truncation first (biggest savings)
    let workingMessages = [...messages];
    let removedCount = 0;
    let summary = '';
    let toolOutputTruncated = false;
    
    if (this.options.maxToolOutputChars > 0) {
      workingMessages = workingMessages.map(msg => {
        if (msg.role === 'tool' && msg.content.length > this.options.maxToolOutputChars) {
          msg.content = truncateToolOutput(msg.content, this.options.maxToolOutputChars);
          removedCount++;
          toolOutputTruncated = true;
          return msg;
        }
        return msg;
      });
      if (toolOutputTruncated) summary += 'truncated tool outputs; ';
    }
    
    // Recalculate after tool truncation
    const afterToolTruncationTokens = this.estimateTotalTokens(workingMessages);
    
    if (afterToolTruncationTokens <= budget.maxPromptTokens && !toolOutputTruncated) {
      return {
        messages: workingMessages,
        originalTokens,
        compactedTokens: afterToolTruncationTokens,
        removedCount,
        summary: 'No compaction needed - within budget',
        budget: budget,
      };
    }

    // 2. Remove old system messages (keep only the first/most recent)
    if (!this.options.preserveSystem) {
      const systemIndices = workingMessages
        .map((msg, i) => msg.role === 'system' ? i : -1)
        .filter(i => i >= 0);
      
      if (systemIndices.length > 1) {
        // Keep only the last system message
        for (let i = systemIndices.length - 2; i >= 0; i--) {
          workingMessages.splice(systemIndices[i], 1);
          removedCount++;
        }
        summary += 'removed duplicate system messages; ';
      }
    }

    // 3. Summarize old conversation turns
    if (this.options.summarizeOldTurns && workingMessages.length > this.options.preserveRecentTurns * 3) {
      const preserveFrom = workingMessages.length - this.options.preserveRecentTurns * 3;
      
      // Find task plan to preserve
      const taskPlan = this.options.preserveTaskPlan ? extractTaskPlan(workingMessages) : null;
      
      // Create summary of old turns
      const oldTurnsSummary = createTurnSummary(workingMessages, 0, preserveFrom - 1);
      
      // Keep: summary + task plan (if found) + recent messages
      const newMessages: Message[] = [
        { role: 'system', content: oldTurnsSummary },
      ];
      
      if (taskPlan) {
        newMessages.push({ role: 'system', content: `## Preserved Task Plan\n\n${taskPlan}` });
      }
      
      // Add recent messages
      newMessages.push(...workingMessages.slice(preserveFrom));
      
      removedCount += preserveFrom;
      workingMessages = newMessages;
      summary += `summarized ${preserveFrom} old turns; `
    }

    // 4. If still over budget, aggressively truncate tool outputs more
    const currentTokens = this.estimateTotalTokens(workingMessages);
    if (currentTokens > budget.maxPromptTokens) {
      // Further reduce tool output limits
      const stricterLimit = Math.max(500, Math.floor(this.options.maxToolOutputChars * 0.3));
      workingMessages = workingMessages.map(msg => {
        if (msg.role === 'tool' && msg.content.length > stricterLimit) {
          msg.content = truncateToolOutput(msg.content, stricterLimit);
          return msg;
        }
        return msg;
      });
      summary += 'aggressively truncated tool outputs; ';
    }

    const compactedTokens = this.estimateTotalTokens(workingMessages);
    
    return {
      messages: workingMessages,
      originalTokens,
      compactedTokens,
      removedCount,
      summary: summary.slice(0, -2) + '.',
      budget: budget,
    };
  }

  private estimateTotalTokens(messages: Message[]): number {
    return messages.reduce((sum, msg) => {
      let tokens = estimateTokens(msg.content);
      if (msg.tool_calls) {
        tokens += msg.tool_calls.reduce((t, tc) => t + estimateTokens(JSON.stringify(tc)), 0);
      }
      return sum + tokens;
    }, 0);
  }
}

/**
 * Quick compaction for emergency use - keeps only essentials
 */
export function emergencyCompact(messages: Message[], maxTokens: number): Message[] {
  const systemMsgs = messages.filter(m => m.role === 'system');
  const userMsgs = messages.filter(m => m.role === 'user');
  const assistantMsgs = messages.filter(m => m.role === 'assistant');
  const toolMsgs = messages.filter(m => m.role === 'tool');
  
  // Keep: first system, last user, last few assistant+tool pairs
  const result: Message[] = [];
  
  if (systemMsgs.length > 0) result.push(systemMsgs[0]);
  if (userMsgs.length > 0) result.push(userMsgs[userMsgs.length - 1]);
  
  // Keep last 3 assistant-tool pairs
  const recentPairs: Message[] = [];
  for (let i = messages.length - 1; i >= 0 && recentPairs.length < 6; i--) {
    if (messages[i].role === 'assistant' || messages[i].role === 'tool') {
      recentPairs.unshift(messages[i]);
    }
  }
  result.push(...recentPairs);
  
  // If still over, truncate tool outputs
  let tokens = result.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  if (tokens > maxTokens) {
    result.forEach(msg => {
      if (msg.role === 'tool') {
        msg.content = truncateToolOutput(msg.content, 500);
      }
    });
  }
  
  return result;
}
