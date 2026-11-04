/**
 * End-to-end workflow tests against the REAL context manager.
 *
 * Unlike the unit tests, these build actual requests from the real workspace:
 * files are read from disk, so they prove the essential rules and per-level
 * rulebook gating actually happen at runtime rather than being mocked.
 */

import { describe, test, expect } from 'bun:test';

import { createAIOfficeContextManager } from '../context-management/index';
import { classifyTask } from '../context-management/task-router';

const WS = process.cwd();

function build(request: string, files: string[]) {
  return createAIOfficeContextManager('claude-opus-5-5', 'tenixe', 'e2e', {
    taskRequest: request,
    affectedFiles: files,
    autoRoute: true,
  });
}

describe('E2E routing and context', () => {
  test('Test A — quick task is T1, no AI 02, essential rules present', async () => {
    const mgr = build('Fix typo in button label', [
      'apps/velshop/src/components/Button.tsx',
    ]);

    const request = await mgr.buildRequest({});
    const classification = mgr.getTaskClassification();

    expect(classification!.level).toBe('T1');
    expect(classification!.requiresAI02).toBe(false);
    expect(classification!.requiresFullQA).toBe(false);

    const joined = request.messages.map((m) => m.content).join('\n');
    expect(joined).toContain('Essential Safety Rules');
    // T1 must not pull the full rulebook or architecture docs.
    expect(joined).not.toContain('Velnox Marketplace Core Rulebook');
    expect(request.metadata.finalTokens).toBeLessThan(3000);
  });

  test('Test B — standard task is T2, AI 02 required, full rules loaded', async () => {
    const mgr = build('Add product comparison feature', [
      'apps/velshop/src/components/ProductCard.tsx',
      'apps/velshop/src/pages/ShopProducts.tsx',
    ]);

    const request = await mgr.buildRequest({});
    const classification = mgr.getTaskClassification();

    expect(classification!.level).toBe('T2');
    expect(classification!.requiresAI02).toBe(true);
    expect(classification!.requiresFullQA).toBe(true);

    const joined = request.messages.map((m) => m.content).join('\n');
    expect(joined).toContain('Essential Safety Rules');
    expect(joined).toContain('Velnox Marketplace Core Rulebook');
  });

  test('Test C — critical task is T3 and is never downgraded', async () => {
    // Superficially trivial request against a critical file.
    const mgr = build('Fix a typo', ['backend/routes/auth.ts']);

    const request = await mgr.buildRequest({});
    const classification = mgr.getTaskClassification();

    expect(classification!.level).toBe('T3');
    expect(classification!.confidence).toBe(1);
    expect(classification!.requiresAI02).toBe(true);
    expect(classification!.requiresFullQA).toBe(true);
    expect(classification!.contextScope).toBe('full');

    const joined = request.messages.map((m) => m.content).join('\n');
    expect(joined).toContain('Essential Safety Rules');
  });

  test('payment and schema files force T3 regardless of wording', () => {
    expect(classifyTask('update text', ['backend/lib/payment-config.ts']).level).toBe('T3');
    expect(classifyTask('small change', ['db/schema.sql']).level).toBe('T3');
    expect(classifyTask('minor fix', ['db/run-sqleditor.sql']).level).toBe('T3');
  });

  test('ambiguous request falls back to T2, never T1', () => {
    const result = classifyTask('do something with the thing');
    expect(result.level).toBe('T2');
    expect(result.requiresAI02).toBe(true);
  });

  test('context grows with task level, not with keyword count', async () => {
    const t1 = await build('Fix typo', ['apps/velshop/src/components/A.tsx']).buildRequest({});
    const t2 = await build('Add feature X', [
      'apps/velshop/src/components/A.tsx',
      'apps/velshop/src/pages/B.tsx',
    ]).buildRequest({});
    const t3 = await build('Modify auth', ['backend/routes/auth.ts']).buildRequest({});

    expect(t1.metadata.finalTokens).toBeLessThan(t2.metadata.finalTokens);
    expect(t2.metadata.finalTokens).toBeLessThan(t3.metadata.finalTokens);
    expect(t1.metadata.withinBudget).toBe(true);
    expect(t2.metadata.withinBudget).toBe(true);
    expect(t3.metadata.withinBudget).toBe(true);
  });

  test('recovery preserves task state and classification', async () => {
    const mgr = build('Add feature X', ['apps/velshop/src/pages/ShopProducts.tsx']);
    mgr.updateTaskContext({
      phase: 'implementation',
      currentStep: 'Writing component',
      completedSteps: ['Analysed requirements'],
      remainingSteps: ['Write tests'],
      changedFiles: ['apps/velshop/src/pages/ShopProducts.tsx'],
    });
    mgr.setCurrentInstruction('Continue');

    const state = mgr.getState();
    const restored = build('Add feature X', ['apps/velshop/src/pages/ShopProducts.tsx']);
    restored.restoreState(state);

    expect(restored.getState().taskContext.currentStep).toBe('Writing component');
    expect(restored.getTaskClassification()!.level).toBe('T2');

    const request = await restored.buildRequest({});
    expect(request.metadata.withinBudget).toBe(true);
    expect(restored.getState().taskContext.currentStep).toBe('Writing component');
  });
});
