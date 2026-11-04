import { classifyTask, getContextSelectionForLevel, TaskLevel } from './task-router';

describe('Task Router', () => {
  describe('classifyTask', () => {
    test('classifies typo fix as T1', () => {
      const result = classifyTask('Fix typo in product card title');
      expect(result.level).toBe('T1');
      expect(result.requiresAI02).toBe(false);
      expect(result.contextScope).toBe('minimal');
    });

    test('classifies translation update as T1', () => {
      const result = classifyTask('Update Thai translation for checkout button');
      expect(result.level).toBe('T1');
    });

    test('classifies color adjustment as T1', () => {
      const result = classifyTask('Change button color from blue to green');
      expect(result.level).toBe('T1');
    });

    test('classifies new feature as T2', () => {
      const result = classifyTask('Add new product comparison feature');
      expect(result.level).toBe('T2');
      expect(result.requiresAI02).toBe(true);
      expect(result.requiresFullQA).toBe(true);
    });

    test('classifies multi-file refactor as T2', () => {
      const result = classifyTask('Refactor checkout flow across multiple files');
      expect(result.level).toBe('T2');
    });

    test('classifies authentication change as T3', () => {
      const result = classifyTask('Modify login session handling');
      expect(result.level).toBe('T3');
      expect(result.contextScope).toBe('full');
    });

    test('classifies payment change as T3', () => {
      const result = classifyTask('Update Stripe payment processing');
      expect(result.level).toBe('T3');
    });

    test('classifies database schema change as T3', () => {
      const result = classifyTask('Add new column to orders table');
      expect(result.level).toBe('T3');
    });

    test('uses file patterns for T3 classification', () => {
      const result = classifyTask('Update some code', ['backend/routes/auth.ts']);
      expect(result.level).toBe('T3');
    });

    test('uses file patterns for T3 with payment files', () => {
      const result = classifyTask('Modify payment logic', ['backend/lib/payment-config.ts']);
      expect(result.level).toBe('T3');
    });

    // Safety tests - critical file patterns should override superficial simplicity
    test('critical file with simple request forces T3', () => {
      const result = classifyTask('Fix a typo', ['backend/routes/auth.ts']);
      expect(result.level).toBe('T3');
      expect(result.confidence).toBe(1.0);
    });

    test('critical file with simple request forces T3 for payment', () => {
      const result = classifyTask('Update text', ['backend/lib/payment-config.ts']);
      expect(result.level).toBe('T3');
      expect(result.confidence).toBe(1.0);
    });

    test('database schema file forces T3', () => {
      const result = classifyTask('Small change', ['db/schema.sql']);
      expect(result.level).toBe('T3');
      expect(result.confidence).toBe(1.0);
    });

    test('run-sqleditor file forces T3', () => {
      const result = classifyTask('Minor update', ['db/run-sqleditor.sql']);
      expect(result.level).toBe('T3');
      expect(result.confidence).toBe(1.0);
    });

    test('checkout page forces T3', () => {
      const result = classifyTask('Fix spacing', ['apps/velshop/src/pages/ShopCheckout.tsx']);
      expect(result.level).toBe('T3');
    });

    test('seller verification component forces T3', () => {
      const result = classifyTask('Change color', ['apps/velcenter/src/components/SellerVerificationQueue.tsx']);
      expect(result.level).toBe('T3');
    });

    // Ambiguous task should default to T2 (safe fallback)
    test('ambiguous task defaults to T2', () => {
      const result = classifyTask('Do something with the thing');
      expect(result.level).toBe('T2');
      expect(result.requiresAI02).toBe(true);
    });

    test('low confidence T1 upgraded to T2', () => {
      const result = classifyTask('Fix it');
      expect(result.level).toBe('T2');
      expect(result.reasoning).toContain('defaulted to T2');
    });

    test('low confidence but T3 keywords keeps T3', () => {
      const result = classifyTask('Auth maybe');
      expect(result.level).toBe('T3');
    });

    test('mixed T1 and T2 keywords picks higher score', () => {
      const result = classifyTask('Fix the feature and add new component');
      expect(['T1', 'T2']).toContain(result.level);
    });
  });

  describe('getContextSelectionForLevel', () => {
    test('T1 uses minimal context', () => {
      const selection = getContextSelectionForLevel('T1', 'Fix typo');
      expect(selection.includeCoreRules).toBe(false);
      expect(selection.includeRecentHistory).toBe(1);
      expect(selection.includeProjectDocs).toHaveLength(0);
    });

    test('essential safety rules are enabled at every level', () => {
      for (const level of ['T1', 'T2', 'T3'] as const) {
        const selection = getContextSelectionForLevel(level, 'anything');
        expect(selection.includeEssentialRules).toBe(true);
      }
    });

    test('T1 skips the full rulebook but keeps essential rules', () => {
      const selection = getContextSelectionForLevel('T1', 'Fix typo');
      expect(selection.includeCoreRules).toBe(false);
      expect(selection.includeEssentialRules).toBe(true);
    });

    test('T2 uses standard context', () => {
      const selection = getContextSelectionForLevel('T2', 'Add feature');
      expect(selection.includeCoreRules).toBe(true);
      expect(selection.includeRecentHistory).toBe(3);
      expect(selection.includeTaskSpec).toBe(true);
    });

    test('T3 uses full context', () => {
      const selection = getContextSelectionForLevel('T3', 'Auth change');
      expect(selection.includeCoreRules).toBe(true);
      expect(selection.includeRecentHistory).toBe(10);
      expect(selection.includeProjectDocs).toContain('.ai/AI_RULES.md');
      expect(selection.includeProjectDocs).toContain('.ai/AI_HANDOFF.md');
    });

    test('infers relevant docs from task spec', () => {
      const selection = getContextSelectionForLevel('T2', 'Fix product catalog');
      expect(selection.includeProjectDocs).toContain('.ai/context/products.md');
    });

    test('infers relevant docs from affected files', () => {
      const selection = getContextSelectionForLevel('T2', '', ['apps/velshop/src/pages/ShopCheckout.tsx']);
      expect(selection.includeProjectDocs).toContain('.ai/context/checkout.md');
    });
  });
});
