/**
 * Sequential AI Office Workflow Orchestrator
 * 
 * Manages the Phase A (Planning) → Phase B (Implementation) → Phase C (QA) →
 * Phase D (Correction Loop) → Final Report workflow with strict sequential execution.
 * All model-generation requests go through the global scheduler.
 */

import { globalRequestScheduler, type AgentIdentity } from './request-scheduler';
import { executeWithScheduler, getSchedulerStatus, persistSchedulerState, restoreSchedulerState } from './agent-wrapper';

export type WorkflowPhase = 
  | 'PLANNING' 
  | 'IMPLEMENTATION' 
  | 'QA' 
  | 'CORRECTION' 
  | 'REVIEW' 
  | 'FINAL_REPORT'
  | 'COMPLETED'
  | 'BLOCKED'
  | 'FAILED';

export type WorkflowStatus = 
  | 'PENDING'
  | 'RUNNING'
  | 'WAITING_FOR_SLOT'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED'
  | 'PAUSED';

export interface WorkflowState {
  taskId: string;
  currentPhase: WorkflowPhase;
  status: WorkflowStatus;
  ai01Result?: any;
  ai02Plan?: any;
  ai02QAResult?: any;
  corrections: Array<{
    round: number;
    defects: any[];
    ai01FixResult?: any;
    ai02ReReviewResult?: any;
  }>;
  reviewIteration: number;
  maxReviewIterations: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  persistedState?: string; // For recovery
}

export interface PhaseResult {
  success: boolean;
  data?: any;
  error?: string;
  phase: WorkflowPhase;
}

/**
 * Workflow Orchestrator - manages the sequential AI01/AI02 workflow
 */
export class WorkflowOrchestrator {
  private state: WorkflowState;
  private listeners: Set<(state: WorkflowState) => void> = new Set();
  private isRunning = false;
  private abortController: AbortController | null = null;

  constructor(taskId: string, maxReviewIterations = 5) {
    this.state = {
      taskId,
      currentPhase: 'PLANNING',
      status: 'PENDING',
      corrections: [],
      reviewIteration: 0,
      maxReviewIterations,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  static fromPersisted(json: string): WorkflowOrchestrator {
    const data = JSON.parse(json);
    const orchestrator = new WorkflowOrchestrator(data.taskId, data.maxReviewIterations);
    orchestrator.state = { ...data, updatedAt: new Date().toISOString() };
    return orchestrator;
  }

  subscribe(listener: (state: WorkflowState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (e) {
        console.error('[Workflow] Listener error:', e);
      }
    }
  }

  private updatePhase(phase: WorkflowPhase, status: WorkflowStatus = 'RUNNING'): void {
    this.state.currentPhase = phase;
    this.state.status = status;
    this.state.updatedAt = new Date().toISOString();
    this.emit();
  }

  getState(): WorkflowState {
    return { ...this.state };
  }

  /**
   * Execute Phase A: AI02 Planning
   */
  async executePlanning(
    taskPrompt: string,
    affectedFiles: string[],
    plannerExecutor: (abortSignal: AbortSignal) => Promise<any>
  ): Promise<PhaseResult> {
    this.updatePhase('PLANNING');
    
    const result = await executeWithScheduler(
      {
        agent: 'AI02',
        taskId: this.state.taskId,
        phase: 'PLANNING',
        description: `Planning: ${taskPrompt.slice(0, 100)}`,
        priority: -10, // High priority for planning
      },
      plannerExecutor
    );

    if (result.success) {
      this.state.ai02Plan = result.data;
      return { success: true, data: result.data, phase: 'PLANNING' };
    } else {
      this.state.lastError = result.error;
      this.updatePhase('PLANNING', 'FAILED');
      return { success: false, error: result.error, phase: 'PLANNING' };
    }
  }

  /**
   * Execute Phase B: AI01 Implementation
   */
  async executeImplementation(
    plan: any,
    implementerExecutor: (abortSignal: AbortSignal) => Promise<any>
  ): Promise<PhaseResult> {
    this.updatePhase('IMPLEMENTATION');
    
    const result = await executeWithScheduler(
      {
        agent: 'AI01',
        taskId: this.state.taskId,
        phase: 'IMPLEMENTATION',
        description: `Implementation: ${this.state.ai02Plan?.APPROACH?.slice(0, 100) || 'implementation'}`,
        priority: 0,
      },
      implementerExecutor
    );

    if (result.success) {
      this.state.ai01Result = result.data;
      return { success: true, data: result.data, phase: 'IMPLEMENTATION' };
    } else {
      this.state.lastError = result.error;
      this.updatePhase('IMPLEMENTATION', 'FAILED');
      return { success: false, error: result.error, phase: 'IMPLEMENTATION' };
    }
  }

  /**
   * Execute Phase C: AI02 QA Review
   */
  async executeQA(
    qaExecutor: (abortSignal: AbortSignal) => Promise<any>
  ): Promise<PhaseResult> {
    this.updatePhase('QA');
    
    const result = await executeWithScheduler(
      {
        agent: 'AI02',
        taskId: this.state.taskId,
        phase: 'QA',
        description: `QA Review round ${this.state.reviewIteration + 1}`,
        priority: -5,
      },
      qaExecutor
    );

    if (result.success) {
      this.state.ai02QAResult = result.data;
      return { success: true, data: result.data, phase: 'QA' };
    } else {
      this.state.lastError = result.error;
      this.updatePhase('QA', 'FAILED');
      return { success: false, error: result.error, phase: 'QA' };
    }
  }

  /**
   * Execute Correction Loop: AI01 fixes defects, then AI02 re-reviews
   */
  async executeCorrectionLoop(
    defects: any[],
    fixerExecutor: (abortSignal: AbortSignal) => Promise<any>,
    reviewerExecutor: (abortSignal: AbortSignal) => Promise<any>
  ): Promise<PhaseResult> {
    const round = this.state.reviewIteration + 1;
    
    if (round > this.state.maxReviewIterations) {
      this.state.lastError = `Max review iterations (${this.state.maxReviewIterations}) exceeded`;
      this.updatePhase('CORRECTION', 'BLOCKED');
      return { success: false, error: this.state.lastError, phase: 'CORRECTION' };
    }

    // Phase D1: AI01 fixes defects
    this.updatePhase('CORRECTION');
    
    const fixResult = await executeWithScheduler(
      {
        agent: 'AI01',
        taskId: this.state.taskId,
        phase: `CORRECTION_ROUND_${round}`,
        description: `Fixing ${defects.length} defects (round ${round})`,
        priority: 0,
      },
      fixerExecutor
    );

    if (!fixResult.success) {
      this.state.lastError = fixResult.error;
      this.updatePhase('CORRECTION', 'FAILED');
      return { success: false, error: fixResult.error, phase: 'CORRECTION' };
    }

    // Phase D2: AI02 re-reviews
    this.updatePhase('REVIEW');
    
    const reviewResult = await executeWithScheduler(
      {
        agent: 'AI02',
        taskId: this.state.taskId,
        phase: `REVIEW_ROUND_${round}`,
        description: `Re-review after fixes (round ${round})`,
        priority: -5,
      },
      reviewerExecutor
    );

    this.state.corrections.push({
      round,
      defects,
      ai01FixResult: fixResult.data,
      ai02ReReviewResult: reviewResult.data,
    });
    this.state.reviewIteration = round;

    if (reviewResult.success) {
      this.state.ai02QAResult = reviewResult.data;
      return { success: true, data: reviewResult.data, phase: 'REVIEW' };
    } else {
      this.state.lastError = reviewResult.error;
      this.updatePhase('REVIEW', 'FAILED');
      return { success: false, error: reviewResult.error, phase: 'REVIEW' };
    }
  }

  /**
   * Execute full workflow with automatic correction loop
   */
  async executeFullWorkflow(
    taskPrompt: string,
    affectedFiles: string[],
    executors: {
      planner: (abortSignal: AbortSignal) => Promise<any>;
      implementer: (abortSignal: AbortSignal) => Promise<any>;
      qa: (abortSignal: AbortSignal) => Promise<any>;
      fixer?: (abortSignal: AbortSignal) => Promise<any>;
      reviewer?: (abortSignal: AbortSignal) => Promise<any>;
    }
  ): Promise<{ success: boolean; finalState: WorkflowState; error?: string }> {
    this.isRunning = true;
    this.abortController = new AbortController();

    try {
      // Phase A: Planning
      const planResult = await this.executePlanning(taskPrompt, affectedFiles, executors.planner);
      if (!planResult.success) {
        return { success: false, finalState: this.getState(), error: planResult.error };
      }

      // Phase B: Implementation
      const implResult = await this.executeImplementation(this.state.ai02Plan, executors.implementer);
      if (!implResult.success) {
        return { success: false, finalState: this.getState(), error: implResult.error };
      }

      // Phase C: Initial QA
      const qaResult = await this.executeQA(executors.qa);
      if (!qaResult.success) {
        return { success: false, finalState: this.getState(), error: qaResult.error };
      }

      // Check QA outcome
      const qaOutcome = this.state.ai02QAResult?.OUTCOME;
      if (qaOutcome === 'PASS') {
        this.updatePhase('FINAL_REPORT', 'COMPLETED');
        return { success: true, finalState: this.getState() };
      }

      if (qaOutcome === 'BLOCKED' || qaOutcome === 'NOT VERIFIED') {
        this.updatePhase('BLOCKED', 'BLOCKED');
        return { success: false, finalState: this.getState(), error: `QA ${qaOutcome}` };
      }

      // Phase D: Correction loop for FAIL
      if (qaOutcome === 'FAIL') {
        const defects = this.state.ai02QAResult?.DEFECTS || [];
        
        if (!executors.fixer || !executors.reviewer) {
          this.state.lastError = 'Correction executors not provided';
          this.updatePhase('FAILED', 'FAILED');
          return { success: false, finalState: this.getState(), error: this.state.lastError };
        }

        let correctionSuccess = false;
        while (this.state.reviewIteration < this.state.maxReviewIterations) {
          const correctionResult = await this.executeCorrectionLoop(
            defects,
            executors.fixer,
            executors.reviewer
          );

          if (!correctionResult.success) {
            return { success: false, finalState: this.getState(), error: correctionResult.error };
          }

          const reReviewOutcome = this.state.ai02QAResult?.OUTCOME;
          if (reReviewOutcome === 'PASS') {
            correctionSuccess = true;
            break;
          }
          
          if (reReviewOutcome === 'BLOCKED' || reReviewOutcome === 'NOT VERIFIED') {
            this.updatePhase('BLOCKED', 'BLOCKED');
            return { success: false, finalState: this.getState(), error: `Re-review ${reReviewOutcome}` };
          }
          
          // Continue loop for another round
          defects.length = 0;
          const newDefects = this.state.ai02QAResult?.DEFECTS || [];
          defects.push(...newDefects);
        }

        if (!correctionSuccess) {
          this.updatePhase('FAILED', 'FAILED');
          return { success: false, finalState: this.getState(), error: 'Max correction rounds exceeded' };
        }
      }

      // Final Report
      this.updatePhase('FINAL_REPORT', 'COMPLETED');
      this.updatePhase('COMPLETED', 'COMPLETED');
      
      return { success: true, finalState: this.getState() };

    } catch (error: any) {
      this.state.lastError = error?.message || String(error);
      this.updatePhase('FAILED', 'FAILED');
      return { success: false, finalState: this.getState(), error: this.state.lastError };
    } finally {
      this.isRunning = false;
      this.abortController = null;
    }
  }

  /**
   * Persist workflow state for recovery
   */
  persist(): string {
    return JSON.stringify({
      ...this.state,
      schedulerState: persistSchedulerState(),
    });
  }

  /**
   * Abort the current workflow
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.isRunning = false;
  }
}

export { WorkflowOrchestrator as orchestrator };
