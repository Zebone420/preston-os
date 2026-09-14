// Phase 1 Lane A - deterministic normalizer fixtures (synthetic only).

import { describe, expect, it } from 'vitest';
import {
  normalizeAddress,
  normalizeEmail,
  normalizePhone,
  propertyKey,
  splitAddressUnit,
} from '../src/lib/business/identity/normalize';

describe('normalizeEmail', () => {
  it('lowercases and trims; keeps gmail dots and plus tags as-is', () => {
    expect(normalizeEmail('  John.Doe+leads@Gmail.com ')).toBe(
      'john.doe+leads@gmail.com',
    );
    expect(normalizeEmail('johndoe@gmail.com')).not.toBe(
      normalizeEmail('john.doe@gmail.com'),
    );
  });

  it('unwraps display-name and mailto forms', () => {
    expect(normalizeEmail('Jane Roe <Jane@Example.org>')).toBe('jane@example.org');
    expect(normalizeEmail('mailto:Ops@Example.org')).toBe('ops@example.org');
  });

  it('returns empty for anything that is not one address', () => {
    for (const bad of ['', 'nope', '@x.com', 'a@', 'a@b', 'a b@c.com',
      'a@@b.com', 'a@.com', 'a@b.', 42 as unknown as string]) {
      expect(normalizeEmail(bad)).toBe('');
    }
  });
});

describe('normalizePhone', () => {
  it('maps every common US format to one E.164 key', () => {
    const want = '+12125550100';
    for (const raw of ['(212) 555-0100', '212.555.0100', '212-555-0100',
      '2125550100', '1-212-555-0100', '+1 212 555 0100', '+1 (212) 555-0100',
      '212 555 0100 x12', '212-555-0100 ext. 7', ' 212/555/0100 ']) {
      expect(normalizePhone(raw)).toBe(want);
    }
  });

  it('keeps non-US numbers as + and digits', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizePhone('+49 (0)30 123456')).toBe('+4930123456');
  });

  it('falls back to digits for odd lengths and refuses short strings', () => {
    expect(normalizePhone('555-0100')).toBe('5550100');
    expect(normalizePhone('12345')).toBe('');
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('call me')).toBe('');
  });
});

describe('normalizeAddress', () => {
  it('uppercases, strips punctuation and abbreviates street words', () => {
    expect(normalizeAddress('123 West 72nd Street, Apt. 4B')).toBe(
      '123 W 72ND ST APT 4B',
    );
    expect(normalizeAddress('45 Fifth Avenue')).toBe('45 FIFTH AVE');
    expect(normalizeAddress('9 Park Place, Brooklyn')).toBe('9 PARK PL BROOKLYN');
    expect(normalizeAddress('10 Ocean Boulevard')).toBe('10 OCEAN BLVD');
  });

  it('normalizes every unit designator to APT / STE / FL', () => {
    expect(normalizeAddress('123 W 72 St #4B')).toBe('123 W 72 ST APT 4B');
    expect(normalizeAddress('123 W 72 St # 4B')).toBe('123 W 72 ST APT 4B');
    expect(normalizeAddress('123 W 72 St Unit 4-B')).toBe('123 W 72 ST APT 4B');
    expect(normalizeAddress('123 W 72 St Apartment 4B')).toBe(
      '123 W 72 ST APT 4B',
    );
    expect(normalizeAddress('123 W 72 St Apt #4B')).toBe('123 W 72 ST APT 4B');
    expect(normalizeAddress('500 Broadway Suite 300')).toBe('500 BROADWAY STE 300');
    expect(normalizeAddress('500 Broadway, 3rd Floor')).toBe('500 BROADWAY 3RD FL');
    expect(normalizeAddress('500 Broadway, Fl 3')).toBe('500 BROADWAY FL 3');
    expect(normalizeAddress('1 Main St PH')).toBe('1 MAIN ST PH');
  });

  it('keeps Queens-style hyphenated house numbers', () => {
    expect(normalizeAddress('12-34 Main Street')).toBe('12-34 MAIN ST');
  });

  it('is deterministic and idempotent', () => {
    const once = normalizeAddress('123 West 72nd Street, Apt. 4B');
    expect(normalizeAddress(once)).toBe(once);
    expect(normalizeAddress('')).toBe('');
  });

  it('splits the unit from the street', () => {
    expect(splitAddressUnit('123 W 72ND ST APT 4B')).toEqual({
      street: '123 W 72ND ST', unit: 'APT 4B',
    });
    expect(splitAddressUnit('123 W 72ND ST')).toEqual({
      street: '123 W 72ND ST', unit: null,
    });
  });
});

describe('propertyKey', () => {
  it('equates the same unit written differently', () => {
    const a = propertyKey('123 West 72nd Street, Apt. 4B');
    const b = propertyKey('123 W 72nd St', '4B');
    const c = propertyKey('123 W. 72ND STREET #4B', null);
    const d = propertyKey('123 W 72nd St', 'Apt 4-B');
    expect(a).toBe('123 W 72ND ST|APT 4B');
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(d).toBe(a);
  });

  it('NEVER equates two units in the same building', () => {
    const a = propertyKey('123 W 72nd St', '4B');
    const b = propertyKey('123 W 72nd St', '5C');
    const bare = propertyKey('123 W 72nd St');
    expect(a).not.toBe(b);
    expect(a).not.toBe(bare);
    expect(bare).toBe('123 W 72ND ST');
  });

  it('explicit unit column wins over an inline unit', () => {
    expect(propertyKey('123 W 72nd St Apt 4B', '5C')).toBe('123 W 72ND ST|APT 5C');
  });
});
