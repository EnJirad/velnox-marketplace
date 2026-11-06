/**
 * Global Single-Request Scheduler for AI Office
 * 
 * Ensures only ONE active model-generation request at a time across all agents
 * using the Tenixe free-model pool. Additional requests queue FIFO.
 * 
 * This is the central concurrency control for preventing "concurrent_streams_exceeded" 429 errors.
 */

export type RequestStatus = 
  | 'QUEUED' 
  | 'WAITING_FOR_SLOT' 
  | 'RUNNING' 
  | 'COMPLETED' 
  | 'FAILED' 
  | 'CANCELLED' 
  | 'RETRY_WAIT'
  | 'PAUSED';

export type AgentIdentity = 'AI01' | 'AI02' | 'PLANNING' | 'EXECUTION';

export interface QueuedRequest {
  id: string;
  agent: AgentIdentity;
  taskId: string;
  phase: string;
  description: string;
  priority: number; // lower = higher priority
  status: RequestStatus;
  enqueuedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  retryCount: number;
  maxRetries: number;
  abortController?: AbortController;
  abortSignal?: AbortSignal;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  // Track if slot has been released to prevent double-release
  _slotReleased?: boolean;
  // Track if a retry is pending after error handling
  _retryPending?: boolean;
}

export interface SchedulerState {
  activeRequest: QueuedRequest | null;
  queue: QueuedRequest[];
  totalProcessed: number;
  totalFailed: number;
  lastError?: string;
  isPaused: boolean;
}

export type SchedulerEvent = 
  | { type: 'ENQUEUED'; request: QueuedRequest; queueLength: number }
  | { type: 'STARTED'; request: QueuedRequest }
  | { type: 'COMPLETED'; request: QueuedRequest; result: any }
  | { type: 'FAILED'; request: QueuedRequest; error: Error }
  | { type: 'CANCELLED'; request: QueuedRequest }
  | { type: 'RETRY_SCHEDULED'; request: QueuedRequest; delayMs: number }
  | { type: 'SLOT_RELEASED'; previousRequest: QueuedRequest; nextRequest?: QueuedRequest }
  | { type: 'STATE_CHANGED'; state: SchedulerState };

export type SchedulerListener = (event: SchedulerEvent) => void;

/**
 * Global singleton scheduler instance
 */
export class GlobalRequestScheduler {
  private static instance: GlobalRequestScheduler;
  private activeRequest: QueuedRequest | null = null;
  private queue: QueuedRequest[] = [];
  private listeners: Set<SchedulerListener> = new Set();
  private totalProcessed = 0;
  private totalFailed = 0;
  private lastError?: string;
  private isPaused = false;
  private requestCounter = 0;
  private recoveryLock = false;

  private constructor() {}

  static getInstance(): GlobalRequestScheduler {
    if (!GlobalRequestScheduler.instance) {
      GlobalRequestScheduler.instance = new GlobalRequestScheduler();
    }
    return GlobalRequestScheduler.instance;
  }

  /**
   * Subscribe to scheduler events for UI/status reporting
   */
  subscribe(listener: SchedulerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SchedulerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[Scheduler] Listener error:', e);
      }
    }
  }

  private getState(): SchedulerState {
    return {
      activeRequest: this.activeRequest,
      queue: [...this.queue],
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed,
      lastError: this.lastError,
      isPaused: this.isPaused,
    };
  }

  /**
   * Generate unique request ID
   */
  private generateId(): string {
    return `req_${Date.now()}_${++this.requestCounter}`;
  }

  /**
   * Enqueue a model-generation request
   * Returns a promise that resolves when the request completes
   */
  async enqueue<T>(
    agent: AgentIdentity,
    taskId: string,
    phase: string,
    description: string,
    executor: (abortSignal: AbortSignal) => Promise<T>,
    options: {
      priority?: number;
      maxRetries?: number;
      onStatusChange?: (status: RequestStatus) => void;
    } = {}
  ): Promise<T> {
    const { priority = 0, maxRetries = 3, onStatusChange } = options;
    const id = this.generateId();
    const abortController = new AbortController();

    const request: QueuedRequest = {
      id,
      agent,
      taskId,
      phase,
      description,
      priority,
      status: 'QUEUED',
      enqueuedAt: new Date().toISOString(),
      retryCount: 0,
      maxRetries,
      abortController,
      abortSignal: abortController.signal,
      resolve: () => {},
      reject: () => {},
      _slotReleased: false,
    };

    // Store executor on the request object
    (request as any).executor = executor;

    return new Promise<T>((resolve, reject) => {
      request.resolve = resolve;
      request.reject = reject;

      this.queue.push(request);
      this.queue.sort((a, b) => a.priority - b.priority || 
        new Date(a.enqueuedAt).getTime() - new Date(b.enqueuedAt).getTime());

      this.emit({
        type: 'ENQUEUED',
        request,
        queueLength: this.queue.length,
      });
      this.emit({ type: 'STATE_CHANGED', state: this.getState() });

      this.processQueue();
    });
  }

  /**
   * Process the queue - start next request if slot is free
   */
  private async processQueue(): Promise<void> {
    if (this.isPaused) return;
    if (this.activeRequest) return;
    if (this.queue.length === 0) return;

    const nextRequest = this.queue.shift()!;
    await this.executeRequest(nextRequest);
  }

  /**
   * Execute a single request with full lifecycle management
   */
  private async executeRequest(request: QueuedRequest): Promise<void> {
    this.activeRequest = request;
    request.status = 'WAITING_FOR_SLOT';
    request.startedAt = new Date().toISOString();
    this.emit({ type: 'STARTED', request });
    this.emit({ type: 'STATE_CHANGED', state: this.getState() });

    request.status = 'RUNNING';
    this.emit({ type: 'STATE_CHANGED', state: this.getState() });

    try {
      // The actual executor is passed via the promise's closure
      // We need to store it somewhere accessible
      const executor = (request as any).executor;
      if (!executor) {
        throw new Error('No executor function attached to request');
      }

      const result = await executor(request.abortSignal);
      
      request.status = 'COMPLETED';
      request.completedAt = new Date().toISOString();
      this.totalProcessed++;

      this.emit({ type: 'COMPLETED', request, result });
      request.resolve(result);

    } catch (error: any) {
      await this.handleError(request, error);
    } finally {
      await this.releaseSlot(request);
    }
  }

  /**
   * Attach executor to a request (called by enqueue promise executor)
   */
  attachExecutor(requestId: string, executor: (abortSignal: AbortSignal) => Promise<any>): void {
    const findRequest = (r: QueuedRequest) => r.id === requestId;
    let request = this.queue.find(findRequest) || 
      (this.activeRequest && findRequest(this.activeRequest) ? this.activeRequest : null);
    
    if (request) {
      (request as any).executor = executor;
    }
  }

  /**
   * Handle request errors with retry logic for 429 concurrency errors
   */
  private async handleError(request: QueuedRequest, error: any): Promise<void> {
    const isConcurrencyError = this.isConcurrencyLimitError(error);
    
    if (isConcurrencyError && request.retryCount < request.maxRetries) {
      request.retryCount++;
      request.status = 'RETRY_WAIT';
      
      // Exponential backoff with jitter: 100ms, 200ms, 400ms... + random 0-50ms (faster for tests)
      const baseDelay = Math.min(100 * Math.pow(2, request.retryCount - 1), 5000);
      const jitter = Math.random() * 50;
      const delayMs = baseDelay + jitter;

      this.emit({ type: 'RETRY_SCHEDULED', request, delayMs });
      this.emit({ type: 'STATE_CHANGED', state: this.getState() });

      // Wait for the active request to complete before retrying (with timeout)
      // Exclude the current request since it will be the active one during retry
      await this.waitForActiveRequestCompletion(5000, request.id);
      
      // Wait for the backoff delay
      await new Promise(resolve => setTimeout(resolve, delayMs));
      
      if (request.abortSignal.aborted) {
        request.status = 'CANCELLED';
        request.reject(new Error('Request cancelled during retry wait'));
        this.emit({ type: 'CANCELLED', request });
        return;
      }

      // Reset slot release flag for retry
      request._slotReleased = false;

      // Re-queue at front for retry
      request.status = 'QUEUED';
      this.queue.unshift(request);
      return;
    }

    // Non-retryable error or max retries exceeded
    request.status = 'FAILED';
    request.error = error?.message || String(error);
    request.completedAt = new Date().toISOString();
    this.totalFailed++;
    this.lastError = request.error;

    this.emit({ type: 'FAILED', request, error });
    request.reject(error);
  }

  /**
   * Check if error is a Tenixe concurrency limit error
   */
  private isConcurrencyLimitError(error: any): boolean {
    if (!error) return false;
    const message = error?.message || error?.toString() || '';
    return message.includes('concurrent_streams_exceeded') ||
           message.includes('429') && message.includes('concurrent');
  }

  private async waitForActiveRequestCompletion(timeoutMs: number = 10000, excludeRequestId?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // If there's no active request, or the active request is the one we're excluding, resolve immediately
      if (!this.activeRequest || (excludeRequestId && this.activeRequest.id === excludeRequestId)) {
        resolve();
        return;
      }
      
      const startTime = Date.now();
      const check = () => {
        if (!this.activeRequest || (excludeRequestId && this.activeRequest.id === excludeRequestId) ||
            this.activeRequest.status === 'COMPLETED' || 
            this.activeRequest.status === 'FAILED' || this.activeRequest.status === 'CANCELLED') {
          resolve();
        } else if (Date.now() - startTime > timeoutMs) {
          reject(new Error('Timeout waiting for active request completion'));
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  /**
   * Release the active slot and process next request
   */
  private async releaseSlot(completedRequest: QueuedRequest): Promise<void> {
    // Prevent double-release
    if (completedRequest._slotReleased) {
      return;
    }
    completedRequest._slotReleased = true;

    const previousRequest = this.activeRequest;
    this.activeRequest = null;

    this.emit({ 
      type: 'SLOT_RELEASED', 
      previousRequest: completedRequest, 
      nextRequest: this.queue[0] 
    });
    this.emit({ type: 'STATE_CHANGED', state: this.getState() });

    // Process next in queue
    if (this.queue.length > 0) {
      await this.processQueue();
    }
  }

  /**
   * Cancel a queued request
   */
  cancel(requestId: string): boolean {
    const index = this.queue.findIndex(r => r.id === requestId);
    if (index >= 0) {
      const request = this.queue.splice(index, 1)[0];
      request.status = 'CANCELLED';
      request.abortController?.abort();
      request.reject(new Error('Request cancelled by user'));
      this.emit({ type: 'CANCELLED', request });
      this.emit({ type: 'STATE_CHANGED', state: this.getState() });
      return true;
    }
    return false;
  }

  /**
   * Cancel the currently active request
   */
  async cancelActive(): Promise<boolean> {
    if (!this.activeRequest) return false;
    
    this.activeRequest.abortController?.abort();
    // The executor should handle abort and reject
    // We'll wait for it to settle
    return true;
  }

  /**
   * Pause the scheduler (stops processing queue)
   */
  pause(): void {
    this.isPaused = true;
    this.emit({ type: 'STATE_CHANGED', state: this.getState() });
  }

  /**
   * Resume the scheduler
   */
  resume(): void {
    this.isPaused = false;
    this.emit({ type: 'STATE_CHANGED', state: this.getState() });
    this.processQueue();
  }

  /**
   * Get current scheduler state for UI
   */
  getCurrentState(): SchedulerState {
    return this.getState();
  }

  /**
   * Get queue status for display
   */
  getQueueStatus(): { 
    active: QueuedRequest | null; 
    queued: QueuedRequest[]; 
    stats: { processed: number; failed: number; queueLength: number } 
  } {
    return {
      active: this.activeRequest,
      queued: [...this.queue],
      stats: {
        processed: this.totalProcessed,
        failed: this.totalFailed,
        queueLength: this.queue.length,
      },
    };
  }

  /**
   * Persist state for recovery
   */
  toJSON(): string {
    return JSON.stringify({
      queue: this.queue.map(r => ({
        id: r.id,
        agent: r.agent,
        taskId: r.taskId,
        phase: r.phase,
        description: r.description,
        priority: r.priority,
        status: r.status,
        enqueuedAt: r.enqueuedAt,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        error: r.error,
        retryCount: r.retryCount,
        maxRetries: r.maxRetries,
      })),
      activeRequest: this.activeRequest ? {
        id: this.activeRequest.id,
        agent: this.activeRequest.agent,
        taskId: this.activeRequest.taskId,
        phase: this.activeRequest.phase,
        description: this.activeRequest.description,
        priority: this.activeRequest.priority,
        status: this.activeRequest.status,
        enqueuedAt: this.activeRequest.enqueuedAt,
        startedAt: this.activeRequest.startedAt,
        completedAt: this.activeRequest.completedAt,
        error: this.activeRequest.error,
        retryCount: this.activeRequest.retryCount,
        maxRetries: this.activeRequest.maxRetries,
      } : null,
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed,
      lastError: this.lastError,
      isPaused: this.isPaused,
    });
  }

  /**
   * Restore state after restart
   */
  static fromJSON(json: string): GlobalRequestScheduler {
    const scheduler = GlobalRequestScheduler.getInstance();
    const data = JSON.parse(json);
    
    scheduler.totalProcessed = data.totalProcessed || 0;
    scheduler.totalFailed = data.totalFailed || 0;
    scheduler.lastError = data.lastError;
    scheduler.isPaused = data.isPaused || false;
    
    // Note: We cannot restore in-flight promises, only queued ones
    // Active request must be re-submitted by the agent
    if (data.activeRequest) {
      // Mark as failed so it can be retried
      scheduler.lastError = 'Application restarted - active request was interrupted';
    }
    
    // Restore queued requests (without promise resolvers and executors)
    scheduler.queue = (data.queue || []).map((r: any) => ({
      ...r,
      abortController: new AbortController(),
      abortSignal: new AbortController().signal,
      resolve: () => {},
      reject: () => {},
      _slotReleased: false,
    })).filter(r => r.status === 'QUEUED' || r.status === 'WAITING_FOR_SLOT' || r.status === 'RETRY_WAIT');
    
    return scheduler;
  }
}

// Export singleton instance
export const globalRequestScheduler = GlobalRequestScheduler.getInstance();
export default globalRequestScheduler;
