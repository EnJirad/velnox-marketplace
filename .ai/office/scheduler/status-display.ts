/**
 * Scheduler Status Display Component
 * 
 * Provides a text-based status display for the AI Office scheduler.
 * Can be used in CLI, logs, or integrated into any UI.
 */

import { getSchedulerStatus, getQueuePreview, subscribeToScheduler, type AgentIdentity } from './agent-wrapper';

export interface StatusDisplayOptions {
  showQueue: boolean;
  showStats: boolean;
  compact: boolean;
}

/**
 * Format scheduler status for display
 */
export function formatSchedulerStatus(options: StatusDisplayOptions = { showQueue: true, showStats: true, compact: false }): string {
  const status = getSchedulerStatus();
  const preview = getQueuePreview();
  
  const lines: string[] = [];
  
  // Header
  const statusIcon = getStatusIcon(status.status);
  lines.push(`${statusIcon} AI Office Scheduler: ${status.status}`);
  
  if (!options.compact) {
    lines.push('');
    
    // Active request
    if (status.activeAgent) {
      lines.push(`  Active Agent: ${status.activeAgent}`);
      lines.push(`  Phase: ${status.activePhase || 'unknown'}`);
      lines.push(`  Task: ${status.activeDescription || 'unknown'}`);
    } else {
      lines.push(`  Active Agent: none`);
    }
    
    lines.push('');
    
    // Queue info
    if (options.showQueue) {
      lines.push(`  Queue: ${status.queueCount} request(s) waiting`);
      if (preview.estimatedWaitMs > 0) {
        const waitMin = Math.ceil(preview.estimatedWaitMs / 60000);
        lines.push(`  Est. Wait: ~${waitMin} min`);
      }
    }
    
    // Stats
    if (options.showStats) {
      lines.push('');
      lines.push(`  Processed: ${status.processedCount} | Failed: ${status.failedCount}`);
    }
  }
  
  return lines.join('\n');
}

/**
 * Get status icon for display
 */
function getStatusIcon(status: string): string {
  switch (status) {
    case 'IDLE': return '⏸️';
    case 'BUSY': return '🔄';
    case 'RETRYING': return '⏳';
    case 'PAUSED': return '⏹️';
    default: return '❓';
  }
}

/**
 * Create a live status display that updates on scheduler events
 */
export function createLiveStatusDisplay(
  onUpdate: (display: string) => void,
  options: StatusDisplayOptions = { showQueue: true, showStats: true, compact: false }
): () => void {
  const update = () => {
    onUpdate(formatSchedulerStatus(options));
  };
  
  // Initial display
  update();
  
  // Subscribe to scheduler events
  const unsubscribe = subscribeToScheduler(() => {
    update();
  });
  
  return unsubscribe;
}

/**
 * Get human-readable agent name
 */
export function getAgentDisplayName(agent: AgentIdentity): string {
  switch (agent) {
    case 'AI01': return 'AI 01 (Developer)';
    case 'AI02': return 'AI 02 (Architect/QA)';
    case 'PLANNING': return 'Planning';
    case 'EXECUTION': return 'Execution';
    default: return agent;
  }
}

/**
 * Format queue for detailed display
 */
export function formatQueueDetail(): string {
  const preview = getQueuePreview();
  const status = getSchedulerStatus();
  
  const lines: string[] = [];
  lines.push('=== AI Office Request Queue ===');
  lines.push('');
  lines.push(formatSchedulerStatus({ showQueue: true, showStats: true, compact: false }));
  lines.push('');
  
  if (status.queueCount > 0) {
    lines.push('Queued Requests:');
    // Note: We can't access the full queue details from getSchedulerStatus
    // This would need direct scheduler access for full details
    lines.push(`  ${status.queueCount} request(s) in queue`);
    lines.push(`  Estimated wait: ~${Math.ceil(preview.estimatedWaitMs / 60000)} min`);
  } else {
    lines.push('Queue is empty');
  }
  
  return lines.join('\n');
}

/**
 * Compact one-line status for embedding in other outputs
 */
export function getCompactStatus(): string {
  const status = getSchedulerStatus();
  const icon = getStatusIcon(status.status);
  const active = status.activeAgent ? ` ${status.activeAgent}:${status.activePhase}` : '';
  return `${icon} Scheduler: ${status.status}${active} | Q:${status.queueCount} P:${status.processedCount} F:${status.failedCount}`;
}
