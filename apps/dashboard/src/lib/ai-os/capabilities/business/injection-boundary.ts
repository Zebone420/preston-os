// Preston AI OS - Phase 3 prompt-injection boundary (CLAUDE.md rule 12;
// master build plan sections 16/17). PURE. Every text that reaches a
// capability is DATA: it is neutralized with the EXISTING guard
// (neutralizeUntrusted - control chars removed, length bounded) and never
// treated as instruction. In addition, an OUTBOUND draft whose text carries
// markers that address the system (instruction overrides, role tags,
// prompt-exfiltration, command execution) is REFUSED, because such text is
// either an injection that reached a worker or a worker that is echoing one.

import { neutralizeUntrusted } from './untrusted';

export interface InjectionMarker {
  id: string;
  re: RegExp;
}

const INSTRUCTION_WORDS = '(instructions?|prompts?|rules?|guidelines?|policies)';
const SECRET_WORDS =
  '(system\\s+prompt|instructions|api\\s+keys?|credentials|secrets?|tokens?)';

export const INJECTION_MARKERS: readonly InjectionMarker[] = [
  { id: 'ignore_previous',
    re: new RegExp('\\bignore\\s+(all\\s+|any\\s+)?(previous|prior|above|earlier)\\s+' +
      INSTRUCTION_WORDS + '\\b', 'i') },
  { id: 'disregard_rules',
    re: new RegExp('\\bdisregard\\s+(all\\s+|any\\s+|your\\s+|the\\s+|previous\\s+|prior\\s+)*' +
      INSTRUCTION_WORDS + '\\b', 'i') },
  { id: 'system_prompt', re: /\bsystem\s+prompt\b/i },
  { id: 'role_override',
    re: /\byou\s+are\s+(now\s+)?(an?\s+|the\s+)?(ai|assistant|system|model|llm)\b/i },
  { id: 'role_tag', re: /(^|\n)\s*(system|assistant|tool|developer)\s*:/i },
  { id: 'xml_tag',
    re: /<\/?\s*(system|instructions?|prompt|tool_call|function_call)\b[^>]*>/i },
  { id: 'bracket_tag', re: /\[\s*(system|inst|assistant)\s*\]/i },
  { id: 'ai_address',
    re: /\b(hey|dear|attention|hello)\s+(ai|assistant|chatgpt|claude|preston\s+ai)\b/i },
  { id: 'exfiltration',
    re: new RegExp('\\b(reveal|print|output|send|show)\\s+(me\\s+)?(your|the)\\s+' +
      SECRET_WORDS + '\\b', 'i') },
  { id: 'command_exec',
    re: /\b(run|execute)\s+(the\s+following\s+)?(command|script|code|shell)\b/i },
];

export interface UntrustedText {
  data: string; // neutralized text - DATA ONLY
  markers: string[]; // ids of the markers found (sorted, unique)
}

export function classifyUntrustedText(text: unknown, maxLen?: number): UntrustedText {
  const data = neutralizeUntrusted(text, maxLen);
  const markers = INJECTION_MARKERS.filter((m) => m.re.test(data)).map((m) => m.id);
  return { data, markers: [...new Set(markers)].sort() };
}

export type OutboundTextGuard =
  | { ok: true; data: string }
  | { ok: false; reason: 'injection_marker_refused'; field: string; markers: string[] };

// Outbound text (subject, body, title, description...) is neutralized and
// REFUSED when any marker addresses the system.
export function guardOutboundText(
  text: unknown, field: string, maxLen?: number,
): OutboundTextGuard {
  const c = classifyUntrustedText(text, maxLen);
  if (c.markers.length > 0) {
    return { ok: false, reason: 'injection_marker_refused', field, markers: c.markers };
  }
  return { ok: true, data: c.data };
}
