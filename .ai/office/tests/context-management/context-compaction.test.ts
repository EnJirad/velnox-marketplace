/**
 * Tests for Context Compaction
 */

import { ContextCompactor, Message, emergencyCompact } from '../../context-management/context-compaction';
import { ContextBudgetManager } from '../../context-management/context-budget';

describe('ContextCompactor', () => {
  let manager: ContextBudgetManager;
  let compactor: ContextCompactor;

  beforeEach(() => {
    manager = new ContextBudgetManager('claude-haiku-5-5');
    (manager as any).currentModel = {
      id: 'claude-haiku-5-5',
      contextWindow: 100000,
      maxOutput: 32768,
      provider: 'tenixe',
    };
    compactor = new ContextCompactor(manager, {
      maxToolOutputChars: 2000,
      preserveRecentTurns: 3,
      preserveTaskPlan: true,
      summarizeOldTurns: true,
    });
  });

  const createMessage = (role: Message['role'], content: string, extras: Partial<Message> = {}): Message => ({
    role,
    content,
    ...extras,
  });

  describe('Basic Compaction', () => {
    test('should not compact when within budget', () => {
      const messages: Message[] = [
        createMessage('system', 'System instructions'),
        createMessage('user', 'Hello'),
        createMessage('assistant', 'Hi there!'),
      ];

      const result = compactor.compact(messages);
      
      expect(result.compactedTokens).toBeLessThanOrEqual(result.budget.maxPromptTokens);
      expect(result.removedCount).toBe(0);
      expect(result.messages).toEqual(messages);
    });

    test('should truncate large tool outputs', () => {
      const largeOutput = 'x'.repeat(5000);
      const messages: Message[] = [
        createMessage('system', 'System'),
        createMessage('user', 'Run tool'),
        createMessage('assistant', 'Calling tool', {
          tool_calls: [{ id: '1', type: 'function', function: { name: 'test', arguments: '{}' } }]
        }),
        createMessage('tool', largeOutput, { tool_call_id: '1', name: 'test' }),
        createMessage('user', 'Thanks'),
        createMessage('assistant', 'Welcome'),
      ];

      // Force compaction by using a very small budget
      const result = compactor.compact(messages, 100); // Very small completion budget to force compaction
      
      const toolMsg = result.messages.find(m => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.content.length).toBeLessThanOrEqual(2000 + 100); // 2000 + truncation marker
      expect(toolMsg!.content).toContain('[TRUNCATED');
    });

    test('should preserve system messages', () => {
      const messages: Message[] = [
        createMessage('system', 'System 1'),
        createMessage('system', 'System 2'),
        createMessage('user', 'Hello'),
        createMessage('assistant', 'Hi'),
      ];

      const result = compactor.compact(messages, 1000); // Force compaction
      
      const systemMsgs = result.messages.filter(m => m.role === 'system');
      expect(systemMsgs.length).toBeGreaterThanOrEqual(1);
    });

    test('should preserve recent turns', () => {
      const messages: Message[] = [];
      // Create 20 messages (10 turns)
      for (let i = 0; i < 10; i++) {
        messages.push(createMessage('user', `User message ${i}`));
        messages.push(createMessage('assistant', `Assistant response ${i}`));
      }

      const result = compactor.compact(messages, 1000); // Force compaction
      
      // Should preserve last 3 turns = 6 messages + summary
      const recentUserMsgs = result.messages
        .filter(m => m.role === 'user')
        .slice(-3);
      expect(recentUserMsgs.length).toBe(3);
      expect(recentUserMsgs[0].content).toContain('User message 7');
      expect(recentUserMsgs[2].content).toContain('User message 9');
    });
  });

  describe('Task Plan Preservation', () => {
    test('should extract and preserve task plan', () => {
      const messages: Message[] = [
        createMessage('system', 'System'),
        createMessage('user', 'Plan this'),
        createMessage('assistant', `TASK BRIEF TEST-001\nREQUEST: Build something\n## STEPS\n1. Step one\n2. Step two\n## ACCEPTANCE CRITERIA\n- Criterion 1`),
        createMessage('user', 'Continue'),
        createMessage('assistant', 'Continuing...'),
        // Add many more messages to trigger summarization
        ...Array.from({ length: 30 }, (_, i) => createMessage('user', `More user ${i}`.repeat(20))),
        ...Array.from({ length: 30 }, (_, i) => createMessage('assistant', `More assistant ${i}`.repeat(20))),
      ];

      // Force compaction with very small budget
      const result = compactor.compact(messages, 50);
      
      // Check if task plan was found
      const allContent = result.messages.map(m => m.content).join('\n');
      expect(allContent).toContain('TASK BRIEF TEST-001');
      expect(allContent).toContain('Step one');
    });
  });

  describe('Tool Call Preservation', () => {
    test('should preserve tool call/result pairs', () => {
      const messages: Message[] = [
        createMessage('system', 'System'),
        createMessage('user', 'Run tool'),
        createMessage('assistant', 'Calling', {
          tool_calls: [{ id: '1', type: 'function', function: { name: 'read_file', arguments: '{"path": "test.ts"}' } }]
        }),
        createMessage('tool', 'File content here', { tool_call_id: '1', name: 'read_file' }),
        createMessage('assistant', 'Done'),
      ];

      const result = compactor.compact(messages, 1000); // Force compaction
      
      // Tool call and result should be preserved together
      const toolCalls = result.messages.filter(m => m.role === 'assistant' && m.tool_calls);
      const toolResults = result.messages.filter(m => m.role === 'tool');
      
      expect(toolCalls.length).toBe(1);
      expect(toolResults.length).toBe(1);
    });
  });
});

describe('Emergency Compact', () => {
  const createMessage = (role: Message['role'], content: string, extras: Partial<Message> = {}): Message => ({
    role,
    content,
    ...extras,
  });

  test('should keep only essentials', () => {
    const messages: Message[] = [
      createMessage('system', 'System instructions'),
      createMessage('system', 'More system'),
      createMessage('user', 'First user'),
      createMessage('assistant', 'First response'),
      createMessage('user', 'Second user'),
      createMessage('assistant', 'Second response'),
      createMessage('tool', 'Tool output', { tool_call_id: '1', name: 'test' }),
      createMessage('assistant', 'Third response'),
      createMessage('user', 'Last user'),
      createMessage('assistant', 'Last response'),
    ];

    const result = emergencyCompact(messages, 5000);
    
    // Should have: 1 system, 1 user (last), recent assistant+tool pairs
    expect(result.length).toBeLessThan(messages.length);
    
    const systemMsgs = result.filter(m => m.role === 'system');
    expect(systemMsgs.length).toBe(1);
    
    const userMsgs = result.filter(m => m.role === 'user');
    expect(userMsgs.length).toBe(1);
    expect(userMsgs[0].content).toBe('Last user');
  });

  test('should truncate tool outputs aggressively', () => {
    const messages: Message[] = [
      createMessage('system', 'System'),
      createMessage('user', 'User'),
      createMessage('assistant', 'Response'),
      createMessage('tool', 'x'.repeat(10000), { tool_call_id: '1', name: 'test' }),
    ];

    const result = emergencyCompact(messages, 1000);
    
    const toolMsg = result.find(m => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content.length).toBeLessThanOrEqual(500 + 100);
  });
});
