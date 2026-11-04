/**
 * Intelligent Task Router
 * 
 * Classifies tasks into T1 (Quick), T2 (Standard), T3 (Critical) levels
 * and determines the appropriate execution path.
 */

export type TaskLevel = 'T1' | 'T2' | 'T3';

export interface TaskClassification {
  level: TaskLevel;
  confidence: number;
  reasoning: string;
  requiresAI02: boolean;
  requiresFullQA: boolean;
  suggestedProfile: 'planning' | 'implementation' | 'qa' | 'recovery';
  contextScope: 'minimal' | 'standard' | 'full';
}

export interface TaskRouterConfig {
  // Keywords that indicate each level
  t1Keywords: string[];
  t2Keywords: string[];
  t3Keywords: string[];
  
  // File patterns that indicate critical areas
  t3FilePatterns: RegExp[];
  
  // Minimum confidence to auto-classify
  minConfidence: number;
}

export const DEFAULT_ROUTER_CONFIG: TaskRouterConfig = {
  t1Keywords: [
    'fix typo', 'fix translation', 'update text', 'change label', 'update copy',
    'adjust color', 'change color', 'update style', 'fix spacing', 'adjust padding',
    'adjust margin', 'fix alignment', 'small fix', 'minor fix', 'quick fix',
    'update icon', 'change icon', 'update image', 'simple change',
    'translation', 'i18n', 'locale', 'language string',
    'typo', 'copy', 'label', 'spacing', 'padding', 'margin', 'alignment',
    'color', 'colour', 'style', 'icon', 'image'
  ],
  t2Keywords: [
    'add feature', 'new feature', 'implement', 'build', 'create',
    'refactor', 'improve', 'enhance', 'optimize', 'redesign',
    'add component', 'new component', 'add page', 'new page',
    'add endpoint', 'new endpoint', 'add api', 'new api',
    'refactor', 'redesign', 'architect', 'architecture',
    'multi-file', 'multiple files', 'several files',
    'system', 'subsystem', 'module', 'integration'
  ],
  t3Keywords: [
    'auth', 'authentication', 'authorization', 'login', 'session',
    'security', 'permission', 'role', 'access control',
    'payment', 'stripe', 'refund', 'checkout', 'order',
    'database', 'schema', 'migration', 'sql', 'transaction',
    'financial', 'money', 'billing', 'invoice', 'pricing',
    'critical', 'urgent', 'production', 'deploy', 'release',
    'verification', 'verify', 'seller verification', 'badge',
    'data integrity', 'data loss', 'corruption'
  ],
  t3FilePatterns: [
    /backend\/routes\/auth\.ts/,
    /backend\/middleware\/auth\.ts/,
    /backend\/lib\/payment/,
    /backend\/lib\/order/,
    /backend\/db\/schema\.sql/,
    /db\/schema\.sql/,
    /db\/run-sqleditor\.sql/,
    /backend\/routes\/stripe\.ts/,
    /backend\/routes\/payment/,
    /apps\/velshop\/src\/pages\/ShopCheckout/,
    /apps\/velshop\/src\/pages\/ShopOrder/,
    /apps\/velseller\/src\/pages\/SellerOrder/,
    /apps\/velcenter\/src\/components\/SellerVerification/,
    /packages\/shared\/src\/lib\/security/,
    /packages\/shared\/src\/lib\/payment/
  ],
  minConfidence: 0.6
};

function scoreKeywords(text: string, keywords: string[]): number {
  const lowerText = text.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (lowerText.includes(kw.toLowerCase())) {
      score += 1;
    }
  }
  return score;
}

function checkFilePatterns(files: string[], patterns: RegExp[]): boolean {
  for (const file of files) {
    for (const pattern of patterns) {
      if (pattern.test(file)) {
        return true;
      }
    }
  }
  return false;
}

export function classifyTask(
  request: string,
  affectedFiles: string[] = [],
  config: TaskRouterConfig = DEFAULT_ROUTER_CONFIG
): TaskClassification {
  const lowerRequest = request.toLowerCase();
  
  // Score each level
  const t1Score = scoreKeywords(lowerRequest, config.t1Keywords);
  const t2Score = scoreKeywords(lowerRequest, config.t2Keywords);
  const t3Score = scoreKeywords(lowerRequest, config.t3Keywords);
  
  // Check file patterns for T3
  const hasT3Files = checkFilePatterns(affectedFiles, config.t3FilePatterns);
  const t3FileBonus = hasT3Files ? 3 : 0;
  
  // Calculate total scores
  const scores = {
    T1: t1Score,
    T2: t2Score,
    T3: t3Score + t3FileBonus
  };
  
  // Determine highest scoring level
  let level: TaskLevel = 'T2'; // default
  let maxScore = scores.T2;
  
  if (scores.T1 > maxScore) {
    maxScore = scores.T1;
    level = 'T1';
  }
  if (scores.T3 > maxScore) {
    maxScore = scores.T3;
    level = 'T3';
  }
  
  // Calculate confidence
  const totalScore = scores.T1 + scores.T2 + scores.T3;
  const confidence = totalScore > 0 ? maxScore / totalScore : 0.5;
  
  // Build reasoning
  const reasons: string[] = [];
  if (t1Score > 0) reasons.push(`T1 keywords: ${t1Score}`);
  if (t2Score > 0) reasons.push(`T2 keywords: ${t2Score}`);
  if (t3Score > 0) reasons.push(`T3 keywords: ${t3Score}`);
  if (hasT3Files) reasons.push('T3 file patterns matched');
  
  // Determine execution parameters
  let requiresAI02 = false;
  let requiresFullQA = false;
  let suggestedProfile: 'planning' | 'implementation' | 'qa' | 'recovery' = 'implementation';
  let contextScope: 'minimal' | 'standard' | 'full' = 'standard';
  
  switch (level) {
    case 'T1':
      requiresAI02 = false;
      requiresFullQA = false;
      suggestedProfile = 'implementation';
      contextScope = 'minimal';
      break;
    case 'T2':
      requiresAI02 = true;
      requiresFullQA = true;
      suggestedProfile = 'planning';
      contextScope = 'standard';
      break;
    case 'T3':
      requiresAI02 = true;
      requiresFullQA = true;
      suggestedProfile = 'planning';
      contextScope = 'full';
      break;
  }
  
  return {
    level,
    confidence,
    reasoning: reasons.join('; ') || 'default classification',
    requiresAI02,
    requiresFullQA,
    suggestedProfile,
    contextScope
  };
}

export function getContextSelectionForLevel(
  level: TaskLevel,
  taskSpec?: string,
  affectedFiles: string[] = []
): {
  includeCoreRules: boolean;
  includeTaskSpec: boolean;
  includeProjectDocs: string[];
  includeSourceCode: string[];
  includeRecentHistory: number;
  includeToolDefinitions: boolean;
  includeCurrentInstruction: boolean;
} {
  const base = {
    includeCoreRules: true,
    includeTaskSpec: !!taskSpec,
    includeProjectDocs: [] as string[],
    includeSourceCode: affectedFiles,
    includeRecentHistory: 0,
    includeToolDefinitions: true,
    includeCurrentInstruction: true
  };
  
  switch (level) {
    case 'T1':
      return {
        ...base,
        includeProjectDocs: [],
        includeRecentHistory: 1,
        includeCoreRules: false // Only essential safety rules
      };
    case 'T2':
      return {
        ...base,
        includeProjectDocs: inferRelevantDocs(taskSpec, affectedFiles),
        includeRecentHistory: 3
      };
    case 'T3':
      return {
        ...base,
        includeProjectDocs: ['.ai/AI_RULES.md', '.ai/AI_HANDOFF.md', ...inferRelevantDocs(taskSpec, affectedFiles)],
        includeRecentHistory: 10
      };
  }
}

function inferRelevantDocs(taskSpec?: string, affectedFiles: string[] = []): string[] {
  const docs: string[] = [];
  const text = (taskSpec || '') + ' ' + affectedFiles.join(' ');
  const lowerText = text.toLowerCase();
  
  const docMap: Record<string, string> = {
    'product': '.ai/context/products.md',
    'catalog': '.ai/context/products.md',
    'category': '.ai/context/categories.md',
    'seller': '.ai/context/seller.md',
    'shop': '.ai/context/seller.md',
    'login': '.ai/context/security.md',
    'session': '.ai/context/security.md',
    'auth': '.ai/context/security.md',
    'upload': '.ai/context/media.md',
    'image': '.ai/context/media.md',
    'r2': '.ai/context/media.md',
    'checkout': '.ai/context/checkout.md',
    'order': '.ai/context/checkout.md',
    'payment': '.ai/context/payment.md',
    'stripe': '.ai/context/payment.md',
    'cod': '.ai/context/payment.md',
    'verification': '.ai/context/verification.md',
    'badge': '.ai/context/verification.md',
    'database': '.ai/context/database.md',
    'schema': '.ai/context/database.md',
    'sql': '.ai/context/database.md',
    'api': '.ai/context/backend.md',
    'backend': '.ai/context/backend.md',
    'websocket': '.ai/context/realtime.md',
    'realtime': '.ai/context/realtime.md',
    'style': '.ai/context/frontend.md',
    'theme': '.ai/context/frontend.md',
    'mobile': '.ai/context/frontend.md',
    'ui': '.ai/context/frontend.md'
  };
  
  for (const [keyword, doc] of Object.entries(docMap)) {
    if (lowerText.includes(keyword)) {
      docs.push(doc);
    }
  }
  
  // Deduplicate
  return [...new Set(docs)];
}
