// Preston Brain Bridge - type contracts for the isolated Letta SDK bridge.
//
// This package is the ONLY place in Preston that depends on @letta-ai/letta-agent-sdk.
// Provider output is UNTRUSTED and ADVISORY only.
//
// Authority boundary: brain-bridge has NO Supabase, OAuth, approval,
// deployment, payment, customer-send, production DB, or filesystem authority.


export interface LettaTurnInput {
  prompt: string;
  mode: 'analysis' | 'planning' | 'synthesis' | 'review';
  actor: string;
  correlation_id: string;
  context: Array<{
    memory_type: string;
    memory_class: string;
    key: string;
    value: unknown;
    source: string;
    version: number;
    created_at: string;
  }>;
  max_memory_candidates: number;
}

export interface LettaTurnOutput {
  response: string;
  memory_candidates?: Array<{
    memory_type: string;
    memory_class: string;
    key: string;
    value: unknown;
    actor: string;
    source: string;
    version: number;
    correlation_id: string;
    audit_ref?: string | null;
  }>;
}

export interface LettaTurnClient {
  runTurn(input: LettaTurnInput): Promise<LettaTurnOutput>;
}
