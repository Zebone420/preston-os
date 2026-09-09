import { describe, expect, it } from 'vitest';
import {
  domainOf,
  isOurAddress,
  normalizeAddress,
  selectSender,
  vendorFacing,
} from '../src/lib/business/comms/alias-registry';
import { OWNER, REGISTRY } from './comms-fixtures';

describe('alias registry - normalizeAddress', () => {
  it('extracts and lowercases the address from a display-name form', () => {
    expect(normalizeAddress('Jane Sample <JANE@Example.com>')).toBe('jane@example.com');
    expect(normalizeAddress('  Owner@Preston.Example.COM ')).toBe(OWNER);
  });
  it('returns empty for non-addresses (fail closed)', () => {
    expect(normalizeAddress('not an address')).toBe('');
    expect(normalizeAddress(undefined)).toBe('');
    expect(normalizeAddress(42)).toBe('');
  });
  it('domainOf and vendorFacing', () => {
    expect(domainOf('ProSupport <prosupport_vip@homedepot.com>')).toBe('homedepot.com');
    expect(vendorFacing('prosupport_vip@homedepot.com')).toBe(true);
    expect(vendorFacing('x@mail.homedepot.com')).toBe(true);
    expect(vendorFacing('jane@example.com')).toBe(false);
    expect(vendorFacing('q@supplier.example.com', ['supplier.example.com'])).toBe(true);
    expect(vendorFacing('nothomedepot.com@example.com')).toBe(false);
  });
  it('isOurAddress matches registry rows only', () => {
    expect(isOurAddress(REGISTRY, `Preston <${OWNER.toUpperCase()}>`)).toBe(true);
    expect(isOurAddress(REGISTRY, 'jane@example.com')).toBe(false);
  });
});

describe('alias registry - selectSender is deterministic and refuses', () => {
  it('picks the single active canonical sender for an allowed class', () => {
    const r = selectSender(REGISTRY, 'client');
    expect(r).toEqual({ ok: true, address: OWNER, mailbox_identity: 'preston-main' });
  });
  it('never picks a non-canonical alias even if the class is allowed', () => {
    const rows = REGISTRY.filter((r) => r.email_address !== OWNER);
    const r = selectSender(rows, 'client');
    expect(r.ok).toBe(false);
  });
  it('never picks an inactive canonical sender', () => {
    const rows = REGISTRY.filter((r) => r.email_address !== OWNER);
    const r = selectSender(rows, 'vendor');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no active canonical sender/);
  });
  it('refuses a class the canonical sender does not allow', () => {
    const rows = [{ ...REGISTRY[0], allowed_send_classes: ['internal'] }];
    const r = selectSender(rows, 'client');
    expect(r.ok).toBe(false);
  });
  it('refuses when two canonical senders would qualify (ambiguity)', () => {
    const rows = [
      REGISTRY[0],
      { ...REGISTRY[0], email_address: 'second@preston.example.com' },
    ];
    const r = selectSender(rows, 'client');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/ambiguous/);
  });
  it('legacy role is never selectable', () => {
    const rows = [{ ...REGISTRY[3], active: true, canonical_sender: true,
      allowed_send_classes: ['client'] }];
    expect(selectSender(rows, 'client').ok).toBe(false);
  });
  it('is pure: same rows, same answer', () => {
    expect(selectSender(REGISTRY, 'vendor')).toEqual(selectSender(REGISTRY, 'vendor'));
  });
});
