// Preston AI OS - Phase 3 gmail.message.draft validation + canonical
// rendering. PURE, deterministic. The draft is EXTERNAL PREPARATION: it
// never sends. Policy applied in order (first failure wins, static reason):
//   1. schema                     schema_invalid:<path>
//   2. sender from alias registry sender_not_in_alias_registry /
//                                 sender_alias_inactive
//   3. recipients vs allowlist    recipient_* / mixed_client_vendor_recipients
//   4. alias may address audience sender_alias_class_not_allowed
//   5. injection boundary         injection_marker_refused
//   6. attachments: strip + manifest  attachment_* / manifest_*
//   7. vendor-facing leakage      client_contact_leakage
// The canonical payload is what a later (owner-gated) live adapter would
// hand to the provider; the sandbox adapter only echoes it.

import type { ParamsValidation } from '../registry';
import { sha256Canonical } from '../contract';
import { GmailDraftParamsSchema, parseWith, type GmailDraftParams } from './schemas';
import { resolveRecipients, vendorLeakReason } from './recipient-allowlist';
import { guardOutboundText } from './injection-boundary';
import { stripDescriptorMetadata, type StrippedDescriptor } from './metadata-strip';
import { verifyAttachmentManifest } from './attachment-manifest';

export interface GmailDraftCanonical extends Record<string, unknown> {
  kind: 'gmail.message.draft';
  project_id: string;
  from: { mailbox_identity: string; email: string };
  to: string[];
  cc: string[];
  audience: string;
  subject: string;
  body_text: string;
  attachments: StrippedDescriptor[];
  manifest_sha256: string;
  metadata_stripped: string[];
}

export function validateGmailDraft(params: Record<string, unknown>): ParamsValidation {
  const parsed = parseWith(GmailDraftParamsSchema, params);
  if (!parsed.ok) return parsed;
  const p: GmailDraftParams = parsed.data;

  const alias = p.sender_aliases.find(
    (a) => a.mailbox_identity === p.sender.mailbox_identity);
  if (!alias) return { ok: false, reason: 'sender_not_in_alias_registry' };
  if (!alias.active) return { ok: false, reason: 'sender_alias_inactive' };

  const rec = resolveRecipients([...p.to, ...(p.cc ?? [])], p.recipient_allowlist, p.project_id);
  if (!rec.ok) return { ok: false, reason: rec.reason };
  if (!alias.allowed_send_classes.includes(rec.audience)) {
    return { ok: false, reason: 'sender_alias_class_not_allowed' };
  }

  const subject = guardOutboundText(p.subject, 'subject', 300);
  if (!subject.ok) return { ok: false, reason: subject.reason };
  const body = guardOutboundText(p.body_text, 'body_text', 4000);
  if (!body.ok) return { ok: false, reason: body.reason };

  const stripped = p.attachments.map((a) => stripDescriptorMetadata(a));
  const manifest = verifyAttachmentManifest(
    stripped.map((s) => s.descriptor), p.attachment_manifest);
  if (!manifest.ok) return { ok: false, reason: manifest.reason };

  const texts = [subject.data, body.data, ...stripped.map((s) => s.descriptor.filename)];
  const leak = vendorLeakReason(rec.audience, texts, p.recipient_allowlist);
  if (leak) return { ok: false, reason: leak };

  const toSet = new Set(p.to.map((e) => e.toLowerCase()));
  const to = rec.resolved.filter((r) => toSet.has(r.email)).map((r) => r.email);
  const cc = rec.resolved.filter((r) => !toSet.has(r.email)).map((r) => r.email);
  const metadataStripped = [...new Set(stripped.flatMap((s) => s.stripped))].sort();
  const canonical: GmailDraftCanonical = {
    kind: 'gmail.message.draft',
    project_id: p.project_id,
    from: { mailbox_identity: alias.mailbox_identity, email: alias.email.toLowerCase() },
    to, cc,
    audience: rec.audience,
    subject: subject.data,
    body_text: body.data,
    attachments: stripped.map((s) => s.descriptor),
    manifest_sha256: manifest.manifest_sha256,
    metadata_stripped: metadataStripped,
  };
  const recipients = rec.resolved.map((r) => r.email).sort().join(',');
  return {
    ok: true,
    canonical,
    binding: {
      project_id: p.project_id,
      document_hash: manifest.entries.length > 0 ? manifest.manifest_sha256 : null,
      amount: null,
      recipient: recipients,
    },
  };
}

export function gmailDraftFingerprint(c: GmailDraftCanonical): string {
  return sha256Canonical(c);
}
