// Preston AI OS - shared operational contracts (Phase 2 foundation).
// Pure types + enums for the multi-agent operating layer. Operational STATE
// lives in Supabase (migration 0003_phase2_ai_os_core.sql); these are the
// typed contracts the dashboard and future workers share. Nothing here
// executes anything - it is data shape + ordering only.

export type AgentProvider =
  | 'anthropic'
  | 'openai'
  | 'preston'
  | 'mcp'
  | 'other';

export type AgentStatus = 'offline' | 'idle' | 'working' | 'blocked' | 'error';

export interface AgentRecord {
  id: string; // stable agent identity slug, e.g. 'claude-code'
  display_name: string;
  provider: AgentProvider;
  model: string;
  capabilities: string[]; // e.g. ['code','review','research']
  allowed_connectors: string[]; // connector keys this agent may use
  status: AgentStatus;
  current_task_id: string | null;
  last_seen: string | null; // ISO timestamp of last heartbeat
  version: string;
  owner: string; // owner identity/email
}

export type MemoryType =
  | 'project'
  | 'architecture'
  | 'decision'
  | 'task'
  | 'execution'
  | 'deployment'
  | 'connector'
  | 'agent'
  | 'checkpoint'
  | 'conversation';

// Every shared-memory entry carries provenance: actor, source, version,
// correlation id, and an audit reference, plus a timestamp.
export interface MemoryEntry {
  id: string;
  memory_type: MemoryType;
  key: string;
  value: unknown; // structured content; never secrets (see memory.ts)
  actor: string; // who wrote it (agent id or owner)
  source: string; // origin subsystem
  version: number; // monotonic per (memory_type,key)
  correlation_id: string;
  audit_ref: string | null;
  created_at: string; // ISO timestamp
}

export type LockScope =
  | 'task'
  | 'approval'
  | 'document'
  | 'repository'
  | 'deployment'
  | 'execution';

export interface LockRecord {
  id: string; // `${scope}:${resource}`
  scope: LockScope;
  resource: string;
  owner: string; // agent id currently holding the lock
  acquired_at: string; // ISO
  expires_at: string; // ISO - locks always expire (no permanent locks)
}

// Execution pipeline stages in STRICT order. Nothing may skip forward; every
// action flows through all gates. See pipeline.ts for the fail-closed machine.
export const PIPELINE_STAGES = [
  'requested',
  'validation',
  'safety_review',
  'approval_decision',
  'execution_intent',
  'execution_queue',
  'worker_lease',
  'execution_attempt',
  'execution_result',
  'rollback',
  'audit',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type ExecutionState =
  | 'pending'
  | 'advancing'
  | 'blocked'
  | 'done'
  | 'failed'
  | 'rolled_back';

export type RiskClass = 'GREEN' | 'YELLOW' | 'RED' | 'BLACK';

export interface ExecutionRecord {
  id: string;
  packet_id: string; // links to an approvals/command packet
  stage: PipelineStage;
  state: ExecutionState;
  risk_class: RiskClass;
  approved: boolean;
  execution_enabled: boolean; // per-record gate; false => never executes
  worker_lease: string | null; // lease token when leased to a worker
  correlation_id: string;
  updated_at: string;
}

export type EventType =
  | 'TaskCreated'
  | 'TaskCompleted'
  | 'ApprovalGranted'
  | 'ApprovalRejected'
  | 'ConnectorOnline'
  | 'ConnectorOffline'
  | 'OAuthExpired'
  | 'OAuthRefreshed'
  | 'WorkerStarted'
  | 'WorkerStopped'
  | 'HermesStarted'
  | 'HermesStopped'
  | 'LockAcquired'
  | 'LockReleased'
  | 'HermesObserved'
  | 'ExecutionBlocked';

export interface OsEvent {
  id: string;
  type: EventType;
  actor: string;
  correlation_id: string;
  payload: Record<string, unknown>;
  created_at: string; // ISO
}
