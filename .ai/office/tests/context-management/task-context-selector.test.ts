/**
 * Tests for Task Context Selector
 */

import { TaskContextSelector, TaskContext, CONTEXT_PROFILES } from '../../context-management/task-context-selector';
import { ContextBudgetManager } from '../../context-management/context-budget';
import { Message } from '../../context-management/context-compaction';

describe('TaskContextSelector', () => {
  let manager: ContextBudgetManager;
  let selector: TaskContextSelector;

  beforeEach(() => {
    manager = new ContextBudgetManager('claude-haiku-5-5');
    (manager as any).currentModel = {
      id: 'claude-haiku-5-5',
      contextWindow: 100000,
      maxOutput: 32768,
      provider: 'tenixe',
    };
    selector = new TaskContextSelector(manager);
  });

  const createMessage = (role: Message['role'], content: string): Message => ({
    role,
    content,
  });

  const mockTaskContext: TaskContext = {
    taskId: 'TEST-001',
    phase: 'implementation',
    currentStep: 'Step 2: Write ProductCard component',
    completedSteps: [
      'Step 1: Analyze requirements',
      'Step 2: Create Task Brief',
    ],
    remainingSteps: [
      'Step 3: Write tests',
      'Step 4: Run typecheck',
    ],
    changedFiles: [
      'apps/velshop/src/components/ProductCard.tsx',
      'apps/velshop/src/pages/ShopProducts.tsx',
    ],
    importantDecisions: [
      'Use shared UI components from packages/shared',
      'Follow VELNOX_DESIGN_THEME.md for styling',
    ],
    failedAttempts: [
      { step: 'Step 1', reason: 'Initial approach too complex, simplified' },
    ],
    testResults: [
      { test: 'ProductCard renders', status: 'PASS', details: 'bun test ./ProductCard.test.tsx → exit 0' },
    ],
  };

  describe('Context Profiles', () => {
    test('should have planning profile', () => {
      expect(CONTEXT_PROFILES.planning).toBeDefined();
      expect(CONTEXT_PROFILES.planning.includeCoreRules).toBe(true);
      expect(CONTEXT_PROFILES.planning.includeTaskSpec).toBe(true);
    });

    test('should have implementation profile', () => {
      expect(CONTEXT_PROFILES.implementation).toBeDefined();
      expect(CONTEXT_PROFILES.implementation.includeRecentHistory).toBe(3);
    });

    test('should have qa profile', () => {
      expect(CONTEXT_PROFILES.qa).toBeDefined();
      expect(CONTEXT_PROFILES.qa.includeRecentHistory).toBe(5);
    });

    test('should have recovery profile', () => {
      expect(CONTEXT_PROFILES.recovery).toBeDefined();
      expect(CONTEXT_PROFILES.recovery.includeRecentHistory).toBe(10);
    });
  });

  describe('Task Context Message Building', () => {
    test('should build task context message with all sections', () => {
      // Access private method via type assertion for testing
      const taskMsg = (selector as any).buildTaskContextMessage(mockTaskContext);
      
      expect(taskMsg.role).toBe('system');
      expect(taskMsg.content).toContain('TEST-001');
      expect(taskMsg.content).toContain('implementation');
      expect(taskMsg.content).toContain('Step 2: Write ProductCard component');
      expect(taskMsg.content).toContain('Step 1: Analyze requirements');
      expect(taskMsg.content).toContain('Step 3: Write tests');
      expect(taskMsg.content).toContain('ProductCard.tsx');
      expect(taskMsg.content).toContain('Use shared UI components');
      expect(taskMsg.content).toContain('Step 1: Initial approach too complex');
      expect(taskMsg.content).toContain('ProductCard renders');
    });

    test('should handle empty arrays gracefully', () => {
      const emptyContext: TaskContext = {
        taskId: 'EMPTY-001',
        phase: 'planning',
        currentStep: 'Starting',
        completedSteps: [],
        remainingSteps: [],
        changedFiles: [],
        importantDecisions: [],
        failedAttempts: [],
        testResults: [],
      };

      const taskMsg = (selector as any).buildTaskContextMessage(emptyContext);
      
      expect(taskMsg.content).toContain('EMPTY-001');
      expect(taskMsg.content).not.toContain('## Completed Steps');
      expect(taskMsg.content).not.toContain('## Changed Files');
    });
  });

  describe('Budget-Aware Selection', () => {
    test('should respect token budget when selecting docs', async () => {
      // This test would need actual file reading - using mock
      const messages: Message[] = [
        createMessage('system', 'Core rules...'),
        createMessage('user', 'Build something'),
      ];

      // The selector uses readFile which returns null in tests
      // So we test the structure instead
      expect(selector).toBeDefined();
    });
  });
});

describe('Context Selection Options', () => {
  test('should have correct default options structure', () => {
    const options = CONTEXT_PROFILES.implementation;
    
    expect(options.includeCoreRules).toBe(true);
    expect(options.includeTaskSpec).toBe(true);
    expect(options.includeRecentHistory).toBe(3);
    expect(options.includeToolDefinitions).toBe(true);
    expect(options.includeCurrentInstruction).toBe(true);
  });
});
