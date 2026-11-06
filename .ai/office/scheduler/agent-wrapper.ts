/**
 * Agent Scheduler Wrapper
 * 
 * Provides a simple interface for AI agents to execute model-generation requests
 * through the global scheduler. This is the integration point between agents
 * and the concurrency control system.
 */

import { globalRequestScheduler, GlobalRequestScheduler, type AgentIdentity, type QueuedRequest } from './request-scheduler';

export interface AgentRequestOptions {
  agent: AgentIdentity;
  taskId: string;
  phase: string;
  description: string;
  priority?: number;
  maxRetries?: number;
  onStatusChange?: (status: string) => void;
}

export interface AgentExecutionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  requestId?: string;
}

/**
 * Execute a model-generation request through the global scheduler
 * 
 * This is the main entry point for agents. It wraps the actual API call
 * with queue management, retry logic, and concurrency control.
 */
export async function executeWithScheduler<T>(
  options: AgentRequestOptions,
  executor: (abortSignal: AbortSignal) => Promise<T>
): Promise<AgentExecutionResult<T>> {
  const { agent, taskId, phase, description, priority = 0, maxRetries = 3, onStatusChange } = options;

  try {
    const result = await globalRequestScheduler.enqueue<T>(
      agent,
      taskId,
      phase,
      description,
      executor,
      { priority, maxRetries, onStatusChange }
    );
    
    return { success: true, data: result };
  } catch (error: any) {
    return { 
      success: false, 
      error: error?.message || String(error) 
    };
  }
}

/**
 * Check if a request would be queued (for UI preview)
 */
export function getQueuePreview(): { 
  wouldQueue: boolean; 
  estimatedWaitMs: number;
  queueLength: number;
  activeRequest?: string;
} {
  const state = globalRequestScheduler.getCurrentState();
  const activeDesc = state.activeRequest?.description || 'none';
  const queueLength = state.queue.length;
  
  // Rough estimate: 30s per request average
  const estimatedWaitMs = queueLength * 30000;
  
  return {
    wouldQueue: state.activeRequest !== null || queueLength > 0,
    estimatedWaitMs,
    queueLength,
    activeRequest: activeDesc,
  };
}

/**
 * Get current scheduler status for UI display
 */
export function getSchedulerStatus(): {
  status: 'IDLE' | 'BUSY' | 'PAUSED' | 'RETRYING';
  activeAgent?: AgentIdentity;
  activePhase?: string;
  activeDescription?: string;
  queueCount: number;
  processedCount: number;
  failedCount: number;
} {
  const state = globalRequestScheduler.getCurrentState();
  
  if (state.isPaused) {
    return { status: 'PAUSED', queueCount: state.queue.length, processedCount: state.totalProcessed, failedCount: state.totalFailed };
  }
  
  if (state.activeRequest) {
    if (state.activeRequest.status === 'RETRY_WAIT') {
      return { 
        status: 'RETRYING', 
        activeAgent: state.activeRequest.agent,
        activePhase: state.activeRequest.phase,
        activeDescription: state.activeRequest.description,
        queueCount: state.queue.length,
        processedCount: state.totalProcessed,
        failedCount: state.totalFailed,
      };
    }
    return { 
      status: 'BUSY', 
      activeAgent: state.activeRequest.agent,
      activePhase: state.activeRequest.phase,
      activeDescription: state.activeRequest.description,
      queueCount: state.queue.length,
      processedCount: state.totalProcessed,
      failedCount: state.totalFailed,
    };
  }
  
  return { 
    status: 'IDLE', 
    queueCount: state.queue.length,
    processedCount: state.totalProcessed,
    failedCount: state.totalFailed,
  };
}

/**
 * Subscribe to scheduler events for real-time UI updates
 */
export function subscribeToScheduler(listener: (event: any) => void): () => void {
  return globalRequestScheduler.subscribe(listener);
}

/**
 * Cancel a specific request by ID
 */
export function cancelRequest(requestId: string): boolean {
  return globalRequestScheduler.cancel(requestId);
}

/**
 * Pause all scheduler processing
 */
export function pauseScheduler(): void {
  globalRequestScheduler.pause();
}

/**
 * Resume scheduler processing
 */
export function resumeScheduler(): void {
  globalRequestScheduler.resume();
}

/**
 * Persist scheduler state for recovery
 */
export function persistSchedulerState(): string {
  return globalRequestScheduler.toJSON();
}

/**
 * Restore scheduler state after restart
 */
export function restoreSchedulerState(json: string): void {
  // The static fromJSON returns the singleton, we just need to call it
  GlobalRequestScheduler.fromJSON(json);
}
