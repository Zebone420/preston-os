import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Gate D drill finding (2026-08-05): the owner, sent to "the owner approval
// surface" to decide a Phase-7 orchestration approval (apr-...), landed on
// the LEGACY Approval Center (/approvals) and decided a legacy business row
// instead - the target approval stayed pending. The two surfaces read
// different tables (public.approvals vs orchestration_approvals). These
// static pins keep the disambiguation visible on both ends.

const src = (p: string) =>
  readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

describe('approval surfaces stay cross-linked and disambiguated', () => {
  it('the legacy Approval Center names the orchestration surface for apr- ids', () => {
    const page = src('app/approvals/page.tsx');
    expect(page).toContain('/os/orchestration');
    expect(page).toContain('apr-');
    expect(page).toMatch(/business control-plane\s+approvals only/);
  });

  // CL-3c live finding (2026-08-05): an expired approval still rendered as
  // plain "pending" with Approve/Reject offered; the RPC refused the click
  // ("approval decision refused: expired") but the surface promised a
  // decision it could not record. Pin: the row computes expiry, withholds
  // decision controls on expired rows, and fails closed on unparseable
  // expiry timestamps.
  it('the orchestration page withholds decision controls on expired approvals', () => {
    const page = src('app/os/orchestration/page.tsx');
    expect(page).toContain("a['decision_open'] !== true");
    expect(page).toContain("=== 'pending' && !expired && (");
    expect(page).toContain("(expired)");
    expect(page).toMatch(/expired - decisions are refused/);
  });

  it('the read model computes decision_open fail-closed on expiry', () => {
    const rmSrc = src('lib/ai-os/orchestration/read-model.ts');
    expect(rmSrc).toMatch(/decision_open: Number\.isFinite\(exp\) && exp > nowMs/);
  });

  it('the composer success card points at /os/orchestration, not a vague surface', () => {
    const form = src('app/os/composer/composer-form.tsx');
    expect(form).toContain('/os/orchestration');
    expect(form).not.toContain('owner approval surface');
    expect(form).toMatch(/NOT the Approval\s+Center/);
  });
});
