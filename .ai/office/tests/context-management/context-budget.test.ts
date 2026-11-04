/**
 * Tests for Context Budget Manager
 */

import { ContextBudgetManager, MODEL_CONFIGS, getEffectiveLimit } from '../../context-management/context-budget';

describe('ContextBudgetManager', () => {
  
  describe('Model Configurations', () => {
    test('should have correct config for gpt-6-astra', () => {
      const config = MODEL_CONFIGS['gpt-6-astra'];
      expect(config.contextWindow).toBe(272000);
      expect(config.maxOutput).toBe(32768);
      expect(config.provider).toBe('tenixe');
    });

    test('should have correct config for claude-haiku-5-5', () => {
      const config = MODEL_CONFIGS['claude-haiku-5-5'];
      expect(config.contextWindow).toBe(100000);
      expect(config.maxOutput).toBe(32768);
    });

    test('should have correct config for claude-opus-5-5', () => {
      const config = MODEL_CONFIGS['claude-opus-5-5'];
      expect(config.contextWindow).toBe(1000000);
      expect(config.maxOutput).toBe(32768);
    });
  });

  describe('Gateway Limits', () => {
    test('should return tenixe gateway limit', () => {
      const limit = getEffectiveLimit('tenixe');
      expect(limit.contextWindow).toBe(200000);
      expect(limit.maxOutput).toBe(32768);
    });

    test('should return aiunlimit gateway limit', () => {
      const limit = getEffectiveLimit('aiunlimit');
      expect(limit.contextWindow).toBe(200000);
    });

    test('should return default for unknown provider', () => {
      const limit = getEffectiveLimit('unknown');
      expect(limit.contextWindow).toBe(100000);
    });
  });

  describe('Budget Calculation', () => {
    test('should calculate budget for gpt-6-astra with tenixe gateway', () => {
      const manager = new ContextBudgetManager('gpt-6-astra');
      // Override with gateway limit
      (manager as any).currentModel = {
        id: 'gpt-6-astra',
        contextWindow: 200000,
        maxOutput: 32768,
        provider: 'tenixe',
      };
      
      const budget = manager.calculateBudget(8192);
      
      // 200000 - 8192 - 30000 (15% safety) = 161808
      expect(budget.maxPromptTokens).toBe(200000 - 8192 - Math.floor(200000 * 0.15));
      expect(budget.maxCompletionTokens).toBe(8192);
      expect(budget.safetyMargin).toBe(Math.floor(200000 * 0.15));
    });

    test('should calculate budget for claude-haiku-5-5 with 100K limit', () => {
      const manager = new ContextBudgetManager('claude-haiku-5-5');
      (manager as any).currentModel = {
        id: 'claude-haiku-5-5',
        contextWindow: 100000,
        maxOutput: 32768,
        provider: 'tenixe',
      };
      
      const budget = manager.calculateBudget(4096);
      
      // 100000 - 4096 - 15000 = 80904
      expect(budget.maxPromptTokens).toBe(100000 - 4096 - Math.floor(100000 * 0.15));
      expect(budget.maxCompletionTokens).toBe(4096);
    });

    test('should respect min/max completion tokens', () => {
      const manager = new ContextBudgetManager('gpt-6-astra', {
        minCompletionTokens: 8192,
        maxCompletionTokens: 16384,
      });
      (manager as any).currentModel = {
        id: 'gpt-6-astra',
        contextWindow: 200000,
        maxOutput: 32768,
        provider: 'tenixe',
      };
      
      // Requesting 2000 should be clamped to min 8192
      const budget1 = manager.calculateBudget(2000);
      expect(budget1.maxCompletionTokens).toBe(8192);
      
      // Requesting 50000 should be clamped to max 16384
      const budget2 = manager.calculateBudget(50000);
      expect(budget2.maxCompletionTokens).toBe(16384);
    });
  });

  describe('Token Estimation', () => {
    test('should estimate tokens roughly', () => {
      const manager = new ContextBudgetManager('gpt-6-astra');
      
      // 4 chars ≈ 1 token
      expect(manager.estimateTokens('hello')).toBe(2); // 5 chars → 2 tokens
      expect(manager.estimateTokens('a'.repeat(100))).toBe(25); // 100 chars → 25 tokens
      expect(manager.estimateTokens('')).toBe(0);
    });
  });

  describe('Budget Check', () => {
    test('should return withinBudget=true for small prompt', () => {
      const manager = new ContextBudgetManager('gpt-6-astra');
      (manager as any).currentModel = {
        id: 'gpt-6-astra',
        contextWindow: 200000,
        maxOutput: 32768,
        provider: 'tenixe',
      };
      
      const smallPrompt = 'Hello world';
      const result = manager.checkBudget(smallPrompt);
      
      expect(result.withinBudget).toBe(true);
      expect(result.estimatedPromptTokens).toBeGreaterThan(0);
    });

    test('should return withinBudget=false for huge prompt', () => {
      const manager = new ContextBudgetManager('claude-haiku-5-5');
      // Use default gateway limit (100K) not tenixe (200K)
      (manager as any).currentModel = {
        id: 'claude-haiku-5-5',
        contextWindow: 100000,
        maxOutput: 32768,
        provider: 'default',
      };
      
      // Budget: 100K - 4096 (min) - 15K (15%) = ~81K tokens max prompt
      // Need more than 81K tokens = ~324K chars
      const hugePrompt = 'x'.repeat(400000); // ~100K tokens
      const result = manager.checkBudget(hugePrompt);
      
      expect(result.withinBudget).toBe(false);
      expect(result.estimatedPromptTokens).toBeGreaterThan(result.maxPromptTokens);
    });
  });
});
