/**
 * Task-Based Context Selection
 * 
 * Builds each API request from relevant information only, rather than
 * sending the entire conversation history or project context.
 */

import { ContextBudgetManager, ContextBudget } from './context-budget';
import { ContextCompactor, Message } from './context-compaction';

export interface TaskContext {
  taskId: string;
  phase: 'planning' | 'implementation' | 'qa' | 'recovery';
  currentStep: string;
  completedSteps: string[];
  remainingSteps: string[];
  changedFiles: string[];
  importantDecisions: string[];
  failedAttempts: { step: string; reason: string }[];
  testResults: { test: string; status: string; details: string }[];
}

export interface ProjectDocument {
  path: string;
  title: string;
  content: string;
  relevance: 'core' | 'subsystem' | 'reference' | 'optional';
  sizeEstimate: number; // tokens
}

export interface ContextSelectionOptions {
  includeCoreRules: boolean;
  includeTaskSpec: boolean;
  includeProjectDocs: string[]; // specific doc paths
  includeSourceCode: string[]; // specific file paths
  includeRecentHistory: number; // number of recent turns
  includeToolDefinitions: boolean;
  includeCurrentInstruction: boolean;
  maxTokens: number;
}

export interface SelectionResult {
  messages: Message[];
  budget: ContextBudget;
  includedDocs: string[];
  includedSource: string[];
  excludedCount: number;
  selectionSummary: string;
}

const CORE_DOCS = [
  { path: '.ai/AI_RULES.md', title: 'Engineering Rules', relevance: 'core' as const },
  { path: '.ai/office/ARCHITECTURE.md', title: 'AI Office Architecture', relevance: 'core' as const },
  { path: '.ai/office/agents/developer.md', title: 'AI 01 Developer Role', relevance: 'core' as const },
  { path: '.ai/office/agents/architect.md', title: 'AI 02 Architect Role', relevance: 'core' as const },
];

export class TaskContextSelector {
  private budgetManager: ContextBudgetManager;
  private compactor: ContextCompactor;
  private projectDocsCache: Map<string, ProjectDocument> = new Map();

  constructor(budgetManager: ContextBudgetManager) {
    this.budgetManager = budgetManager;
    this.compactor = new ContextCompactor(budgetManager);
  }

  /**
   * Build a context-optimized message array for the current task
   */
  async buildContext(
    taskContext: TaskContext,
    currentInstruction: string,
    recentMessages: Message[],
    options: Partial<ContextSelectionOptions> = {}
  ): Promise<SelectionResult> {
    const opts: ContextSelectionOptions = {
      includeCoreRules: true,
      includeTaskSpec: true,
      includeProjectDocs: [],
      includeSourceCode: [],
      includeRecentHistory: 3,
      includeToolDefinitions: true,
      includeCurrentInstruction: true,
      maxTokens: this.budgetManager.getMaxPromptTokens(),
      ...options,
    };

    const budget = this.budgetManager.calculateBudget();
    const messages: Message[] = [];
    let usedTokens = 0;
    const includedDocs: string[] = [];
    const includedSource: string[] = [];
    let excludedCount = 0;

    // 1. Core system instructions (always included, compacted)
    if (opts.includeCoreRules) {
      const coreMessages = await this.loadCoreDocuments();
      for (const msg of coreMessages) {
        const tokens = this.estimateTokens(msg.content);
        if (usedTokens + tokens <= budget.maxPromptTokens * 0.3) { // Reserve 30% for core
          messages.push(msg);
          usedTokens += tokens;
          includedDocs.push(msg.content.slice(0, 50) + '...');
        } else {
          excludedCount++;
        }
      }
    }

    // 2. Current task specification
    if (opts.includeTaskSpec) {
      const taskMsg = this.buildTaskContextMessage(taskContext);
      const tokens = this.estimateTokens(taskMsg.content);
      if (usedTokens + tokens <= budget.maxPromptTokens * 0.4) { // Reserve 40% for task
        messages.push(taskMsg);
        usedTokens += tokens;
      }
    }

    // 3. Relevant project documentation (on-demand)
    if (opts.includeProjectDocs.length > 0) {
      for (const docPath of opts.includeProjectDocs) {
        const doc = await this.loadProjectDocument(docPath);
        if (doc && usedTokens + doc.sizeEstimate <= budget.maxPromptTokens * 0.2) {
          messages.push({
            role: 'system',
            content: `## ${doc.title}\n\n${doc.content}`
          });
          usedTokens += doc.sizeEstimate;
          includedDocs.push(docPath);
        } else {
          excludedCount++;
        }
      }
    }

    // 4. Relevant source code (on-demand)
    if (opts.includeSourceCode.length > 0) {
      for (const srcPath of opts.includeSourceCode) {
        const src = await this.loadSourceFile(srcPath);
        if (src && usedTokens + src.sizeEstimate <= budget.maxPromptTokens * 0.1) {
          messages.push({
            role: 'system',
            content: `## Source: ${srcPath}\n\n\`\`\`\n${src.content}\n\`\`\``
          });
          usedTokens += src.sizeEstimate;
          includedSource.push(srcPath);
        } else {
          excludedCount++;
        }
      }
    }

    // 5. Recent execution history (compacted)
    if (opts.includeRecentHistory > 0 && recentMessages.length > 0) {
      const recent = recentMessages.slice(-opts.includeRecentHistory * 3); // ~3 messages per turn
      const compacted = this.compactor.compact(recent);
      messages.push(...compacted.messages);
      usedTokens += compacted.compactedTokens;
    }

    // 6. Current user instruction
    if (opts.includeCurrentInstruction) {
      const instructionMsg: Message = {
        role: 'user',
        content: currentInstruction
      };
      const tokens = this.estimateTokens(currentInstruction);
      if (usedTokens + tokens <= budget.maxPromptTokens) {
        messages.push(instructionMsg);
        usedTokens += tokens;
      }
    }

    // Final compaction if still over budget
    if (usedTokens > budget.maxPromptTokens) {
      const compacted = this.compactor.compact(messages);
      return {
        messages: compacted.messages,
        budget,
        includedDocs,
        includedSource,
        excludedCount: excludedCount + compacted.removedCount,
        selectionSummary: `Selected ${includedDocs.length} docs, ${includedSource.length} source files, ${compacted.messages.length} messages (compacted from ${messages.length})`
      };
    }

    return {
      messages,
      budget: { ...budget, estimatedPromptTokens: usedTokens, withinBudget: usedTokens <= budget.maxPromptTokens },
      includedDocs,
      includedSource,
      excludedCount,
      selectionSummary: `Selected ${includedDocs.length} docs, ${includedSource.length} source files, ${messages.length} messages`
    };
  }

  private async loadCoreDocuments(): Promise<Message[]> {
    const messages: Message[] = [];
    
    for (const doc of CORE_DOCS) {
      const content = await this.readFile(doc.path);
      if (content) {
        messages.push({
          role: 'system',
          content: `## ${doc.title}\n\n${content}`
        });
      }
    }
    
    return messages;
  }

  private buildTaskContextMessage(taskContext: TaskContext): Message {
    let content = `# Task Context: ${taskContext.taskId}\n\n`;
    content += `**Phase**: ${taskContext.phase}\n`;
    content += `**Current Step**: ${taskContext.currentStep}\n\n`;
    
    if (taskContext.completedSteps.length > 0) {
      content += `## Completed Steps\n`;
      taskContext.completedSteps.forEach((step, i) => {
        content += `${i + 1}. ${step}\n`;
      });
      content += '\n';
    }
    
    if (taskContext.remainingSteps.length > 0) {
      content += `## Remaining Steps\n`;
      taskContext.remainingSteps.forEach((step, i) => {
        content += `${i + 1}. ${step}\n`;
      });
      content += '\n';
    }
    
    if (taskContext.changedFiles.length > 0) {
      content += `## Changed Files\n`;
      taskContext.changedFiles.forEach(f => content += `- ${f}\n`);
      content += '\n';
    }
    
    if (taskContext.importantDecisions.length > 0) {
      content += `## Important Decisions\n`;
      taskContext.importantDecisions.forEach(d => content += `- ${d}\n`);
      content += '\n';
    }
    
    if (taskContext.failedAttempts.length > 0) {
      content += `## Failed Attempts\n`;
      taskContext.failedAttempts.forEach(f => content += `- ${f.step}: ${f.reason}\n`);
      content += '\n';
    }
    
    if (taskContext.testResults.length > 0) {
      content += `## Test Results\n`;
      taskContext.testResults.forEach(t => content += `- ${t.test}: ${t.status} - ${t.details}\n`);
      content += '\n';
    }
    
    return { role: 'system', content };
  }

  private async loadProjectDocument(path: string): Promise<ProjectDocument | null> {
    // Check cache first
    if (this.projectDocsCache.has(path)) {
      return this.projectDocsCache.get(path)!;
    }
    
    const content = await this.readFile(path);
    if (!content) return null;
    
    const doc: ProjectDocument = {
      path,
      title: path.split('/').pop() || path,
      content,
      relevance: 'subsystem',
      sizeEstimate: this.estimateTokens(content)
    };
    
    this.projectDocsCache.set(path, doc);
    return doc;
  }

  private async loadSourceFile(path: string): Promise<ProjectDocument | null> {
    const content = await this.readFile(path);
    if (!content) return null;
    
    return {
      path,
      title: path.split('/').pop() || path,
      content,
      relevance: 'reference',
      sizeEstimate: this.estimateTokens(content)
    };
  }

  private async readFile(path: string): Promise<string | null> {
    // In the actual implementation, this would read from the workspace
    // For now, return null - the actual file reading happens in the agent
    try {
      // This is a placeholder - actual implementation uses the file system tools
      return null;
    } catch {
      return null;
    }
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Clear the document cache (useful between tasks)
   */
  clearCache(): void {
    this.projectDocsCache.clear();
  }
}

/**
 * Pre-defined context profiles for common task types
 */
export const CONTEXT_PROFILES = {
  planning: {
    includeCoreRules: true,
    includeTaskSpec: true,
    includeProjectDocs: ['.ai/context/architecture.md', '.ai/context/backend.md'],
    includeSourceCode: [],
    includeRecentHistory: 1,
    includeToolDefinitions: true,
    includeCurrentInstruction: true,
    maxTokens: 0, // use budget manager default
  },
  
  implementation: {
    includeCoreRules: true,
    includeTaskSpec: true,
    includeProjectDocs: ['.ai/context/frontend.md', '.ai/context/database.md'],
    includeSourceCode: [], // populated dynamically based on task
    includeRecentHistory: 3,
    includeToolDefinitions: true,
    includeCurrentInstruction: true,
    maxTokens: 0,
  },
  
  qa: {
    includeCoreRules: true,
    includeTaskSpec: true,
    includeProjectDocs: ['.ai/context/testing.md'],
    includeSourceCode: [], // implementation files being reviewed
    includeRecentHistory: 5,
    includeToolDefinitions: true,
    includeCurrentInstruction: true,
    maxTokens: 0,
  },
  
  recovery: {
    includeCoreRules: true,
    includeTaskSpec: true,
    includeProjectDocs: ['.ai/AI_HANDOFF.md'],
    includeSourceCode: [], // recently changed files
    includeRecentHistory: 10,
    includeToolDefinitions: true,
    includeCurrentInstruction: true,
    maxTokens: 0,
  },
} as const;
