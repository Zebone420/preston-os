import type { MemoryType } from '../ai-os/types';

// Preston Super Brain v1 - provider-neutral contracts.
// The Brain may recall context and propose memory. It has no execution,
// approval, deployment, credential, payment, or policy authority.

export type BrainMemoryClass = 'working' | 'institutional' | 'business' | 'lesson';
export type BrainCapability = 'recall' | 'propose_memory';

export interface BrainQuery {
  query: string;
  correlation_id: string;
  actor: string;
  limit?: number;
  memory_classes?: BrainMemoryClass[];
  memory_types?: MemoryType[];
}

export interface BrainContextItem {
  memory_type: MemoryType;
  memory_class: BrainMemoryClass;
  key: string;
  value: unknown;
  source: string;
  actor: string;
  version: number;
  correlation_id: string;
  audit_ref: string | null;
  created_at: string;
  score?: number;
}

export interface BrainMemoryCandidate {
  memory_type: MemoryType;
  memory_class: BrainMemoryClass;
  key: string;
  value: unknown;
  actor: string;
  source: string;
  version: number;
  correlation_id: string;
  audit_ref?: string | null;
}

export type BrainPolicyReason =
  | 'invalid_memory'
  | 'secret_key'
  | 'secret_value'
  | 'authority_claim'
  | 'forbidden_capability';

export interface BrainPolicyDecision {
  allowed: boolean;
  reasons: BrainPolicyReason[];
  sanitized_value?: unknown;
}

export interface BrainProvider {
  readonly id: string;
  readonly capabilities: readonly BrainCapability[];
  recall(query: BrainQuery): Promise<BrainContextItem[]>;
}

export interface BrainMemorySink {
  append(candidate: BrainMemoryCandidate): Promise<{ ok: boolean; id?: string; error?: string }>;
}
