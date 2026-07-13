import { describe, expect, it } from 'vitest';
import {
  CARD_FIELDS,
  formatDateValue,
  toCardItems,
} from '../src/lib/cards';

const rec = (id: string, fields: Record<string, unknown>) => ({ id, fields });

describe('formatDateValue', () => {
  it('formats a date-only ISO string', () => {
    expect(formatDateValue('2026-07-15')).toBe('Jul 15, 2026');
  });

  it('formats a datetime ISO string on a 12-hour clock', () => {
    expect(formatDateValue('2026-07-15T13:30:00.000Z')).toBe(
      'Jul 15, 2026, 1:30 PM',
    );
  });

  it('handles midnight and noon boundaries', () => {
    expect(formatDateValue('2026-01-01T00:05:00Z')).toBe('Jan 1, 2026, 12:05 AM');
    expect(formatDateValue('2026-01-01T12:00:00Z')).toBe('Jan 1, 2026, 12:00 PM');
  });

  it('returns undefined for non-date strings', () => {
    expect(formatDateValue('not a date')).toBeUndefined();
    expect(formatDateValue('Kitchen consult')).toBeUndefined();
  });
});

describe('toCardItems - title selection', () => {
  it('picks the highest-priority present field', () => {
    const items = toCardItems(
      [rec('rec1', { Subject: 'Kitchen consult', Name: 'ignored' })],
      CARD_FIELDS.today,
    );
    expect(items[0].title).toBe('Kitchen consult');
  });

  it('skips an empty priority field and uses the next', () => {
    const items = toCardItems(
      [rec('rec1', { Type: '', Subject: 'Measure' })],
      CARD_FIELDS.today,
    );
    expect(items[0].title).toBe('Measure');
  });

  it('formats a date detail field cleanly', () => {
    const items = toCardItems(
      [rec('rec1', { Subject: 'Measure', Date: '2026-07-15' })],
      CARD_FIELDS.today,
    );
    expect(items[0].detail).toBe('Jul 15, 2026');
  });
});

describe('toCardItems - fallback and id safety', () => {
  it('falls back to the first displayable value when no priority field matches', () => {
    const items = toCardItems(
      [rec('rec1', { Misc: 'Something useful' })],
      CARD_FIELDS.leads,
    );
    expect(items[0].title).toBe('Something useful');
  });

  it('never shows a raw record id; uses a placeholder when nothing is displayable', () => {
    const items = toCardItems(
      [rec('recABCDEFGHIJKLMNO', {})],
      CARD_FIELDS.leads,
    );
    expect(items[0].title).toBe('(untitled record)');
    expect(items[0].title).not.toMatch(/^rec[A-Za-z0-9]{14,}$/);
  });

  it('does not display id-shaped field values (linked record ids)', () => {
    const items = toCardItems(
      [rec('rec1', { Link: 'recABCDEFGHIJKLMNO', Name: 'Real Client' })],
      CARD_FIELDS.leads,
    );
    expect(items[0].title).toBe('Real Client');
  });

  it('skips id-shaped values in the fallback too', () => {
    const items = toCardItems(
      [rec('rec1', { Link: 'fldABCDEFGHIJKLMNO' })],
      CARD_FIELDS.projects,
    );
    expect(items[0].title).toBe('(untitled record)');
  });

  it('joins array (multi-select) values, dropping id-shaped entries', () => {
    const items = toCardItems(
      [rec('rec1', { Name: 'Job', Status: ['Open', 'recABCDEFGHIJKLMNO'] })],
      CARD_FIELDS.projects,
    );
    expect(items[0].detail).toBe('Open');
  });

  it('does not crash on empty fields or null/undefined values', () => {
    expect(() =>
      toCardItems([rec('rec1', {})], CARD_FIELDS.quotes),
    ).not.toThrow();
    const items = toCardItems(
      [rec('rec1', { Name: null, Status: undefined })],
      CARD_FIELDS.quotes,
    );
    expect(items[0].title).toBe('(untitled record)');
    expect(items[0].detail).toBeUndefined();
  });
});
