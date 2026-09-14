// Message -> project linker. Deterministic signals evaluated in precedence
// order; the identity ladder caps automatic links at 'linked_auto' -
// 'confirmed' is an owner action and is NEVER produced here.
//
//   1. Project ID (P26-nnnn) in subject or attachment filename -> linked_auto
//   2. Known thread mapping                                    -> linked_auto
//   3. Home Depot case / H1256 quote number mapping             -> linked_auto
//   4. Approved client/contact address alias                   -> candidate
//   5. Property address match                                  -> candidate
//   Ambiguous signal (several projects) -> orphan + review reason.

import type { AttachmentMeta, LinkConfidence } from './types';
import { normalizeAddress } from './alias-registry';

export interface LinkProject {
  id: string;
  project_code?: string | null;
  property_address?: string | null;
}

export interface LinkIndex {
  projects: LinkProject[];
  // provider_thread_id -> project id
  threadMap?: Record<string, string>;
  // HD case number or H1256 quote number -> project id
  hdRefs?: Record<string, string>;
  // normalized approved contact address -> project ids
  contactAliases?: Record<string, string[]>;
}

export interface LinkMessageInput {
  subject: string;
  bodyText?: string;
  attachments?: AttachmentMeta[];
  threadId?: string | null;
  from: string;
  to?: string[];
}

export interface LinkResult {
  project_id: string | null;
  link_confidence: LinkConfidence;
  link_signal: string;
  review_reason?: string;
}

export const PROJECT_CODE_RE = /\bP\d{2}-\d{4}\b/g;
const HD_CASE_RE = /\bCase\s*(?:Submitted\s*)?#?\s*(\d{6,10})\b/gi;
const HD_QUOTE_RE = /\bH1256-\d{4,8}\b/gi;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function orphan(reason: string, signal: string): LinkResult {
  return {
    project_id: null,
    link_confidence: 'orphan',
    link_signal: signal,
    review_reason: reason,
  };
}

function normalizeAddressText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(street|st\.?)\b/g, 'st')
    .replace(/\b(avenue|ave\.?)\b/g, 'ave')
    .replace(/\b(road|rd\.?)\b/g, 'rd')
    .replace(/\b(place|pl\.?)\b/g, 'pl')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function linkMessageToProject(
  message: LinkMessageInput,
  index: LinkIndex,
): LinkResult {
  const byId = new Map(index.projects.map((p) => [p.id, p]));
  const filenames = (message.attachments ?? []).map((a) => a.name).join('\n');
  const haystack = `${message.subject}\n${filenames}`;

  // 1. Project code in subject / filename.
  const codes = unique(haystack.match(PROJECT_CODE_RE) ?? []);
  if (codes.length > 0) {
    const matched = unique(
      codes
        .map((c) =>
          index.projects.find(
            (p) => (p.project_code ?? '').toUpperCase() === c.toUpperCase(),
          )?.id ?? '',
        )
        .filter((id) => id !== ''),
    );
    if (matched.length === 1) {
      return {
        project_id: matched[0],
        link_confidence: 'linked_auto',
        link_signal: `project_code:${codes[0]}`,
      };
    }
    if (matched.length > 1) {
      return orphan(
        `multiple project codes resolve: ${matched.join(',')}`,
        'project_code_ambiguous',
      );
    }
    // A code that matches no project is left for review; other signals
    // still run because the code may be a typo.
  }

  // 2. Known thread mapping.
  const threadId = message.threadId ?? '';
  const threadProject = threadId ? index.threadMap?.[threadId] : undefined;
  if (threadProject && byId.has(threadProject)) {
    return {
      project_id: threadProject,
      link_confidence: 'linked_auto',
      link_signal: `thread:${threadId}`,
    };
  }

  // 3. Home Depot case / quote number mapping.
  const bodyHay = `${haystack}\n${message.bodyText ?? ''}`;
  const hdRefs = unique([
    ...[...bodyHay.matchAll(HD_CASE_RE)].map((m) => m[1]),
    ...(bodyHay.match(HD_QUOTE_RE) ?? []).map((q) => q.toUpperCase()),
  ]);
  const hdMatched = unique(
    hdRefs
      .map((r) => index.hdRefs?.[r] ?? '')
      .filter((id) => id !== '' && byId.has(id)),
  );
  if (hdMatched.length === 1) {
    return {
      project_id: hdMatched[0],
      link_confidence: 'linked_auto',
      link_signal: `hd_ref:${hdRefs.find((r) => index.hdRefs?.[r] ===
        hdMatched[0]) ?? ''}`,
    };
  }
  if (hdMatched.length > 1) {
    return orphan(
      `HD references resolve to several projects: ${hdMatched.join(',')}`,
      'hd_ref_ambiguous',
    );
  }

  // 4. Approved contact alias (weaker: candidate).
  const parties = [message.from, ...(message.to ?? [])]
    .map(normalizeAddress)
    .filter((a) => a !== '');
  const aliasMatched = unique(
    parties.flatMap((a) => index.contactAliases?.[a] ?? []).filter((id) =>
      byId.has(id)),
  );
  if (aliasMatched.length === 1) {
    return {
      project_id: aliasMatched[0],
      link_confidence: 'candidate',
      link_signal: 'contact_alias',
    };
  }
  if (aliasMatched.length > 1) {
    return orphan(
      `contact alias maps to several projects: ${aliasMatched.join(',')}`,
      'contact_alias_ambiguous',
    );
  }

  // 5. Property address match (weaker: candidate).
  const text = normalizeAddressText(bodyHay);
  const addressMatched = index.projects
    .filter((p) => {
      const addr = normalizeAddressText(p.property_address ?? '');
      return addr.length >= 6 && text.includes(addr);
    })
    .map((p) => p.id);
  if (addressMatched.length === 1) {
    return {
      project_id: addressMatched[0],
      link_confidence: 'candidate',
      link_signal: 'property_address',
    };
  }
  if (addressMatched.length > 1) {
    return orphan(
      `property address matches several projects: ${addressMatched.join(',')}`,
      'property_address_ambiguous',
    );
  }

  if (codes.length > 0) {
    return orphan(`unknown project code ${codes.join(',')}`, 'project_code_unknown');
  }
  return orphan('no linking signal', 'none');
}
