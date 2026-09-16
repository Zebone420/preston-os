import { redactSecrets, validateMemoryEntry } from '../ai-os/memory';
import type { BrainMemoryCandidate, BrainPolicyDecision, BrainPolicyReason } from './types';

const SECRET_KEY =
  /(secret|token|password|passwd|\bpat\b|api[_-]?key|client[_-]?secret|private[_-]?key|refresh[_-]?token|bearer|cookie|credential)/i;

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i,
  /\bpat[A-Za-z0-9]{14,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b(?:api[_-]?key|token|password|secret|credential)\s*[:=]\s*[^\s,;]{8,}/i,
];

const AUTHORITY_PATTERNS: readonly RegExp[] = [
  /\b(?:owner|admin|administrator)\b[^.\n]{0,50}\b(?:approved|authorized)\b[^.\n]{0,50}\b(?:all|future|permanent|standing|blanket)\b/i,
  /\b(?:skip|bypass|disable|waive|omit|suppress)\b[^.\n]{0,40}\b(?:approval|authorization|guard|policy|review)\b/i,
  /\b(?:approval|authorization)\b[^.\n]{0,20}\b(?:not required|unnecessary|automatic|permanent)\b/i,
  /\bself[- ]?approve(?:d|s|al)?\b/i,
];

interface ScanResult {
  secretKey: boolean;
  secretValue: boolean;
  authorityClaim: boolean;
}

function scanValue(value: unknown): ScanResult {
  const result: ScanResult = { secretKey: false, secretValue: false, authorityClaim: false };

  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(node))) result.secretValue = true;
      if (AUTHORITY_PATTERNS.some((pattern) => pattern.test(node))) result.authorityClaim = true;
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        if (SECRET_KEY.test(key)) result.secretKey = true;
        visit(child);
      }
    }
  };

  visit(value);
  return result;
}

export function evaluateMemoryCandidate(candidate: BrainMemoryCandidate): BrainPolicyDecision {
  const reasons: BrainPolicyReason[] = [];
  const validation = validateMemoryEntry({
    memory_type: candidate.memory_type,
    key: candidate.key,
    actor: candidate.actor,
    source: candidate.source,
    version: candidate.version,
    correlation_id: candidate.correlation_id,
  });
  if (!validation.ok) reasons.push('invalid_memory');
  if (SECRET_KEY.test(candidate.key)) reasons.push('secret_key');

  const scan = scanValue(candidate.value);
  if (scan.secretKey && !reasons.includes('secret_key')) reasons.push('secret_key');
  if (scan.secretValue) reasons.push('secret_value');
  if (scan.authorityClaim) reasons.push('authority_claim');

  if (reasons.length > 0) return { allowed: false, reasons };
  return { allowed: true, reasons: [], sanitized_value: redactSecrets(candidate.value) };
}

export function assertBrainCapability(capability: string): BrainPolicyDecision {
  if (capability === 'recall' || capability === 'reason' || capability === 'propose_memory') {
    return { allowed: true, reasons: [] };
  }
  return { allowed: false, reasons: ['forbidden_capability'] };
}
