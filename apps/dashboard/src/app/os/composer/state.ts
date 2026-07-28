// Preston AI OS - Phase 7 Composer action state (shared client/server shape).
// Plain data module: no server directive, no side effects.

import type { ComposerProposal } from '@/lib/ai-os/orchestration/composer';
import type { CreatedGoalGraph } from '@/lib/ai-os/orchestration/composer-persist';

export interface ComposerActionState {
  step: 'idle' | 'proposal' | 'created' | 'error';
  raw_request: string;
  request_key: string; // request-level idempotency key, minted at compose time
  proposal: ComposerProposal | null;
  created: CreatedGoalGraph[];
  replayed: boolean;
  errors: string[];
  notice: string;
}

export const INITIAL_COMPOSER_STATE: ComposerActionState = {
  step: 'idle', raw_request: '', request_key: '', proposal: null,
  created: [], replayed: false, errors: [], notice: '',
};
