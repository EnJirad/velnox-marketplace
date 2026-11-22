export interface MigrationFile {
  readonly name: string;
  readonly path: string;
  readonly checksum: string;
  readonly sql: string;
}

export interface MigrationRecord {
  readonly id: number;
  readonly name: string;
  readonly checksum: string;
  readonly executed_at: string;
  readonly execution_time_ms: number;
}

export interface MigrationPlan {
  readonly applied: readonly MigrationRecord[];
  readonly pending: readonly MigrationFile[];
}

export interface MigrationResult {
  readonly appliedCount: number;
  readonly appliedMigrations: readonly string[];
  readonly totalExecutionTimeMs: number;
}

export interface DbQueryable {
  query(sql: string, params?: any[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}
