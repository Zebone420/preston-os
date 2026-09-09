import { describe, expect, it } from 'vitest';
import {
  detectClientContactLeak,
  normalizePhone,
} from '../src/lib/business/comms/contact-leak';
import { CLIENT_CONTACTS, OWNER } from './comms-fixtures';

const HD = 'prosupport_vip@homedepot.com';

describe('contact leak - owner hard rule', () => {
  it('flags the incident shape: HD-bound request carrying client email + phone', () => {
    const r = detectClientContactLeak({
      recipients: [HD],
      bodyText:
        'Pricing Quote Request - Jane Sample - 12 Sample St\n' +
        'Client: Jane Sample, jane@example.com, (212) 555-0142',
      clientContacts: CLIENT_CONTACTS,
      allowedDomains: ['preston.example.com'],
    });
    expect(r.vendor_bound).toBe(true);
    expect(r.leaked).toBe(true);
    expect(r.vendor_recipients).toEqual([HD]);
    const kinds = r.hits.map((h) => `${h.kind}:${h.match}`).sort();
    expect(kinds).toEqual(['email:client_contact', 'phone:client_contact']);
    // Findings are masked; the raw contact never appears in the finding.
    for (const h of r.hits) {
      expect(h.masked).not.toContain('jane@example.com');
      expect(h.masked).not.toContain('5550142');
    }
  });
  it('a name + property address only NQR passes', () => {
    const r = detectClientContactLeak({
      recipients: [HD],
      bodyText: 'Pricing Quote Request - Jane Sample - 12 Sample St, Brooklyn.\n' +
        'Please quote 4 double-hung units per the attached spec.',
      clientContacts: CLIENT_CONTACTS,
    });
    expect(r.vendor_bound).toBe(true);
    expect(r.leaked).toBe(false);
    expect(r.hits).toEqual([]);
  });
  it('our own and the vendor addresses are not leaks', () => {
    const r = detectClientContactLeak({
      recipients: [HD],
      bodyText: `Reply to ${OWNER} or ${HD}.`,
      clientContacts: CLIENT_CONTACTS,
      allowedDomains: ['preston.example.com'],
    });
    expect(r.leaked).toBe(false);
  });
  it('an unknown third-party email in vendor material is flagged (unknown_contact)', () => {
    const r = detectClientContactLeak({
      recipients: [HD],
      bodyText: 'cc the architect at studio@architects.example.com',
      clientContacts: CLIENT_CONTACTS,
    });
    expect(r.leaked).toBe(true);
    expect(r.hits[0].match).toBe('unknown_contact');
  });
  it('a client-bound message with contact details is not vendor-bound', () => {
    const r = detectClientContactLeak({
      recipients: ['jane@example.com'],
      bodyText: 'Your number on file is (212) 555-0142',
      clientContacts: CLIENT_CONTACTS,
    });
    expect(r.vendor_bound).toBe(false);
    expect(r.leaked).toBe(false);
  });
  it('scans attachment text and reports the location', () => {
    const r = detectClientContactLeak({
      recipients: ['orders@mail.homedepot.com'],
      bodyText: 'See attached.',
      attachmentsText: 'Contact: 212-555-0142',
      clientContacts: CLIENT_CONTACTS,
    });
    expect(r.leaked).toBe(true);
    expect(r.hits[0]).toMatchObject({ kind: 'phone', location: 'attachment' });
  });
  it('normalizePhone handles +1 and separators', () => {
    expect(normalizePhone('+1 (212) 555-0142')).toBe('2125550142');
    expect(normalizePhone('212.555.0142')).toBe('2125550142');
    expect(normalizePhone('12345')).toBe('');
  });
});
