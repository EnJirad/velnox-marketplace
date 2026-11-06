/**
 * AI Office Request Scheduler - Main Entry Point
 * 
 * Provides the global single-request scheduler for all Tenixe free-model requests.
 * Ensures AI01 and AI02 never send overlapping model-generation requests.
 */

export {
  GlobalRequestScheduler,
  globalRequestScheduler,
  type RequestStatus,
  type AgentIdentity,
  type QueuedRequest,
  type SchedulerState,
  type SchedulerEvent,
  type SchedulerListener,
} from './request-scheduler';

export {
  executeWithScheduler,
  getQueuePreview,
  getSchedulerStatus,
  subscribeToScheduler,
  cancelRequest,
  pauseScheduler,
  resumeScheduler,
  persistSchedulerState,
  restoreSchedulerState,
} from './agent-wrapper';

export {
  WorkflowOrchestrator,
  type WorkflowPhase,
  type WorkflowStatus,
  type WorkflowState,
  type PhaseResult,
} from './workflow-orchestrator';

export { globalRequestScheduler as scheduler } from './request-scheduler';
