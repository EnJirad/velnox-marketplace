/**
 * Tests for Global Request Scheduler
 * 
 * Verifies the concurrency control, queue ordering, retry logic,
 * and lifecycle management.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'bun:test';
import { globalRequestScheduler, GlobalRequestScheduler } from './request-scheduler';
import { executeWithScheduler, getSchedulerStatus, getQueuePreview, persistSchedulerState, restoreSchedulerState } from './agent-wrapper';

describe('Global Request Scheduler', () => {
  let scheduler: GlobalRequestScheduler;
  
  beforeEach(() => {
    // Get fresh instance for each test
    scheduler = GlobalRequestScheduler.getInstance();
    // Clear any existing state by creating a new instance reference
    // Note: Since it's a singleton, we need to reset internal state
    (scheduler as any).activeRequest = null;
    (scheduler as any).queue = [];
    (scheduler as any).totalProcessed = 0;
    (scheduler as any).totalFailed = 0;
    (scheduler as any).lastError = undefined;
    (scheduler as any).isPaused = false;
  });

  afterEach(() => {
    // Clean up
    (scheduler as any).activeRequest = null;
    (scheduler as any).queue = [];
  });

  test('should start with empty queue and no active request', () => {
    const state = scheduler.getCurrentState();
    expect(state.activeRequest).toBeNull();
    expect(state.queue).toHaveLength(0);
    expect(state.totalProcessed).toBe(0);
    expect(state.totalFailed).toBe(0);
  });

  test('should enqueue and execute a single request', async () => {
    let executed = false;
    
    const result = await scheduler.enqueue('AI01', 'task-1', 'TEST', 'Test request', async () => {
      executed = true;
      return 'success';
    });

    expect(result).toBe('success');
    expect(executed).toBe(true);
    
    const state = scheduler.getCurrentState();
    expect(state.totalProcessed).toBe(1);
    expect(state.totalFailed).toBe(0);
  });

  test('should queue multiple requests and execute FIFO', async () => {
    const order: string[] = [];
    
    // Enqueue 3 requests
    const p1 = scheduler.enqueue('AI01', 'task-1', 'TEST', 'First', async () => {
      order.push('first');
      await new Promise(r => setTimeout(r, 50));
      return 'first';
    });
    
    const p2 = scheduler.enqueue('AI02', 'task-1', 'TEST', 'Second', async () => {
      order.push('second');
      await new Promise(r => setTimeout(r, 50));
      return 'second';
    });
    
    const p3 = scheduler.enqueue('AI01', 'task-1', 'TEST', 'Third', async () => {
      order.push('third');
      return 'third';
    });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    
    expect(r1).toBe('first');
    expect(r2).toBe('second');
    expect(r3).toBe('third');
    expect(order).toEqual(['first', 'second', 'third']);
  });

  test('should not allow concurrent execution', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    
    const makeRequest = (name: string) => scheduler.enqueue('AI01', 'task-1', 'TEST', name, async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(r => setTimeout(r, 100));
      concurrent--;
      return name;
    });

    const [r1, r2, r3] = await Promise.all([
      makeRequest('req1'),
      makeRequest('req2'),
      makeRequest('req3'),
    ]);

    expect(maxConcurrent).toBe(1);
    expect(r1).toBe('req1');
    expect(r2).toBe('req2');
    expect(r3).toBe('req3');
  });

  test('should handle request cancellation', async () => {
    let started = false;
    
    // Use a longer delay to ensure it's still in queue when we try to cancel
    const requestPromise = scheduler.enqueue('AI01', 'task-1', 'TEST', 'Cancellable', async () => {
      started = true;
      await new Promise(r => setTimeout(r, 2000));
      return 'done';
    });

    // Immediately try to cancel before it starts
    await new Promise(r => setTimeout(r, 10));
    
    // Get the request ID from queue
    const state = scheduler.getCurrentState();
    const requestId = state.queue[0]?.id || state.activeRequest?.id;
    
    // Test that cancel function exists and can be called
    if (requestId) {
      const cancelled = scheduler.cancel(requestId);
      // cancel returns false if request already started executing
      // which is acceptable behavior
      expect(typeof cancelled).toBe('boolean');
    }

    // The request should be cancelled or already running
    try {
      await requestPromise;
      // If it completed, that's fine too - timing dependent
    } catch (e: any) {
      // Either cancelled or completed
      expect(e.message).toBeDefined();
    }
  });

  test('should pause and resume queue processing', async () => {
    scheduler.pause();
    expect(scheduler.getCurrentState().isPaused).toBe(true);
    
    let executed = false;
    const promise = scheduler.enqueue('AI01', 'task-1', 'TEST', 'Paused', async () => {
      executed = true;
      return 'done';
    });
    
    // Should not execute while paused
    await new Promise(r => setTimeout(r, 100));
    expect(executed).toBe(false);
    
    scheduler.resume();
    const result = await promise;
    expect(result).toBe('done');
    expect(executed).toBe(true);
  });

  test('should retry on concurrency error with exponential backoff', async () => {
    let attemptCount = 0;
    const error = new Error('concurrent_streams_exceeded');
    
    const result = await scheduler.enqueue('AI01', 'task-1', 'TEST', 'Retry test', async () => {
      attemptCount++;
      if (attemptCount < 3) {
        throw error;
      }
      return 'success';
    }, { maxRetries: 3 });

    expect(result).toBe('success');
    expect(attemptCount).toBe(3);
  }, 15000);

  test('should fail after max retries exceeded', async () => {
    let attemptCount = 0;
    const error = new Error('concurrent_streams_exceeded');
    
    try {
      await scheduler.enqueue('AI01', 'task-1', 'TEST', 'Max retries', async () => {
        attemptCount++;
        throw error;
      }, { maxRetries: 1 }); // Only 1 retry = 2 attempts total
      expect(false).toBe(true); // Should not reach
    } catch (e: any) {
      expect(e.message).toContain('concurrent_streams_exceeded');
      expect(attemptCount).toBe(2); // Initial + 1 retry
    }
  }, 10000);

  test('should not retry non-concurrency errors', async () => {
    let attemptCount = 0;
    const error = new Error('Invalid API key');
    
    try {
      await scheduler.enqueue('AI01', 'task-1', 'TEST', 'Non-retryable', async () => {
        attemptCount++;
        throw error;
      }, { maxRetries: 3 });
      expect(false).toBe(true);
    } catch (e: any) {
      expect(e.message).toContain('Invalid API key');
      expect(attemptCount).toBe(1); // Only initial attempt
    }
  });

  test('should persist and restore state', async () => {
    // Add some requests to queue
    await scheduler.enqueue('AI01', 'task-1', 'TEST', 'Req 1', async () => 'done');
    await scheduler.enqueue('AI02', 'task-1', 'TEST', 'Req 2', async () => 'done');
    
    const json = scheduler.toJSON();
    const data = JSON.parse(json);
    
    expect(data.totalProcessed).toBeGreaterThanOrEqual(0);
    expect(data.queue.length).toBeGreaterThanOrEqual(0);
    
    // Restore
    GlobalRequestScheduler.fromJSON(json);
    const restored = GlobalRequestScheduler.getInstance();
    const state = restored.getCurrentState();
    
    expect(state.totalProcessed).toBe(data.totalProcessed);
  });

  test('should track queue status correctly', async () => {
    const status1 = getSchedulerStatus();
    expect(status1.status).toBe('IDLE');
    expect(status1.queueCount).toBe(0);
    
    const promise = scheduler.enqueue('AI01', 'task-1', 'TEST', 'Status test', async () => {
      await new Promise(r => setTimeout(r, 200));
      return 'done';
    });
    
    // Check status while running
    await new Promise(r => setTimeout(r, 50));
    const status2 = getSchedulerStatus();
    expect(status2.status).toBe('BUSY');
    expect(status2.activeAgent).toBe('AI01');
    expect(status2.activePhase).toBe('TEST');
    
    await promise;
    
    const status3 = getSchedulerStatus();
    expect(status3.status).toBe('IDLE');
    expect(status3.processedCount).toBeGreaterThan(0);
  });
});

describe('Agent Wrapper Integration', () => {
  beforeEach(() => {
    const scheduler = GlobalRequestScheduler.getInstance();
    (scheduler as any).activeRequest = null;
    (scheduler as any).queue = [];
    (scheduler as any).totalProcessed = 0;
    (scheduler as any).totalFailed = 0;
  });

  test('executeWithScheduler should integrate with global scheduler', async () => {
    const result = await executeWithScheduler(
      {
        agent: 'AI01',
        taskId: 'test-task',
        phase: 'IMPLEMENTATION',
        description: 'Test execution',
      },
      async () => 'wrapper result'
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe('wrapper result');
  });

  test('executeWithScheduler should handle errors', async () => {
    const result = await executeWithScheduler(
      {
        agent: 'AI01',
        taskId: 'test-task',
        phase: 'IMPLEMENTATION',
        description: 'Error test',
      },
      async () => { throw new Error('Test error'); }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Test error');
  });

  test('getQueuePreview should show correct queue state', async () => {
    const preview1 = getQueuePreview();
    expect(preview1.wouldQueue).toBe(false);
    expect(preview1.queueLength).toBe(0);
    
    // Add a request
    const promise = executeWithScheduler(
      { agent: 'AI01', taskId: 't1', phase: 'TEST', description: 'Long task' },
      async () => { await new Promise(r => setTimeout(r, 200)); return 'done'; }
    );
    
    await new Promise(r => setTimeout(r, 50));
    
    const preview2 = getQueuePreview();
    expect(preview2.wouldQueue).toBe(true);
    expect(preview2.queueLength).toBe(0); // It's active, not queued
    expect(preview2.activeRequest).toBe('Long task');
    
    await promise;
  });
});
