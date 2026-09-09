import { describe, expect, it } from 'vitest';
import { classifyMessage } from '../src/lib/business/comms/classify';
import { HD_QUOTE_ATTACHMENTS, OWNER } from './comms-fixtures';

const base = { to: [OWNER], snippet: '' };

describe('comms classifier - DROP rules first', () => {
  it('OTP / verification codes are DROP with a reason', () => {
    const r = classifyMessage({
      ...base,
      from: 'no-reply@accounts.example.com',
      subject: 'Your verification code',
      snippet: '482913 is your code',
    });
    expect(r.ingestion_class).toBe('DROP');
    expect(r.drop_reason).toBe('otp_code');
  });
  it('password reset, security alert, sign-in link are DROP', () => {
    const cases: [string, string][] = [
      ['Reset your password', 'password_reset'],
      ['Security alert: new sign-in on Windows', 'security_alert'],
      ['Your magic link to sign in', 'auth_link'],
    ];
    for (const [subject, reason] of cases) {
      const r = classifyMessage({ ...base, from: 'x@example.com', subject });
      expect(r.ingestion_class).toBe('DROP');
      expect(r.drop_reason).toBe(reason);
    }
  });
  it('DROP wins even when the sender is a business domain', () => {
    const r = classifyMessage({
      ...base,
      from: 'security@homedepot.com',
      subject: 'Your one-time code for Pro Xtra',
    });
    expect(r.ingestion_class).toBe('DROP');
  });
  it('unsubscribe-only promotional noise is DROP', () => {
    const r = classifyMessage({
      ...base,
      from: 'deals@shop.example.com',
      subject: 'Flash sale this weekend',
      snippet: 'Unsubscribe any time',
    });
    expect(r.ingestion_class).toBe('DROP');
    expect(r.drop_reason).toBe('promotional_noise');
  });
  it('unknown sender with no business signal is DROP (fail closed)', () => {
    const r = classifyMessage({
      ...base,
      from: 'stranger@example.net',
      subject: 'hello',
      snippet: 'hi there',
    });
    expect(r.ingestion_class).toBe('DROP');
    expect(r.drop_reason).toBe('no_business_signal');
  });
});

describe('comms classifier - FINANCE_RESTRICTED', () => {
  it('receipts and invoices are finance restricted', () => {
    const r = classifyMessage({
      ...base,
      from: 'receipts@homedepot.com',
      subject: 'Your Home Depot receipt',
    });
    expect(r.ingestion_class).toBe('FINANCE_RESTRICTED');
  });
  it('payment processor domains are finance restricted', () => {
    const r = classifyMessage({
      ...base,
      from: 'notifications@stripe.com',
      subject: 'You have a new payout',
    });
    expect(r.ingestion_class).toBe('FINANCE_RESTRICTED');
    expect(r.signal).toBe('finance_domain');
  });
  it('SaaS billing and insurance billing are finance restricted', () => {
    for (const subject of [
      'Your subscription renewal notice',
      'Insurance premium due',
    ]) {
      const r = classifyMessage({ ...base, from: 'billing@saas.example.com', subject });
      expect(r.ingestion_class).toBe('FINANCE_RESTRICTED');
    }
  });
});

describe('comms classifier - EVENT_ONLY', () => {
  it('mailer-daemon bounces are event-only', () => {
    const r = classifyMessage({
      ...base,
      from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
      subject: 'Delivery Status Notification (Failure)',
    });
    expect(r.ingestion_class).toBe('EVENT_ONLY');
    expect(r.signal).toBe('bounce');
  });
  it('Google Voice missed call / sms notifications are event-only', () => {
    for (const subject of [
      'Missed call from (212) 555-0142',
      'New text message from (212) 555-0142',
    ]) {
      const r = classifyMessage({ ...base, from: 'voice-noreply@google.com', subject });
      expect(r.ingestion_class).toBe('EVENT_ONLY');
      expect(r.signal).toBe('voice');
    }
  });
  it('order-ready notifications are event-only', () => {
    const r = classifyMessage({
      ...base,
      from: 'orders@homedepot.com',
      subject: 'Your order is ready for pickup',
    });
    expect(r.ingestion_class).toBe('EVENT_ONLY');
    expect(r.signal).toBe('order_status');
  });
});

describe('comms classifier - INCLUDE_PROJECT', () => {
  it('Andersen, Home Depot quotes and DocuSign are project messages', () => {
    const cases = [
      ['certifiedcontractor@e.andersencorp.com', 'Sam, you have a new lead!'],
      ['prosupport_vip@homedepot.com', 'Case Submitted #12345678'],
      ['dse@docusign.net', 'Completed: Preston Contract'],
    ];
    for (const [from, subject] of cases) {
      const r = classifyMessage({ ...base, from, subject });
      expect(r.ingestion_class).toBe('INCLUDE_PROJECT');
      expect(r.signal).toBe('business_domain');
    }
  });
  it('a known contact or known thread is a business party', () => {
    const known = classifyMessage({
      ...base,
      from: 'jane@example.com',
      subject: 'thanks',
      knownContacts: ['Jane <JANE@example.com>'],
    });
    expect(known.ingestion_class).toBe('INCLUDE_PROJECT');
    expect(known.signal).toBe('known_contact');
    const thread = classifyMessage({
      ...base,
      from: 'someone@example.org',
      subject: 'ok',
      knownThread: true,
    });
    expect(thread.ingestion_class).toBe('INCLUDE_PROJECT');
  });
  it('business keywords (architect/LPC/windows) qualify an unknown sender', () => {
    const r = classifyMessage({
      ...base,
      from: 'studio@architects.example.com',
      subject: 'Landmarks submission for the window replacement',
    });
    expect(r.ingestion_class).toBe('INCLUDE_PROJECT');
    expect(r.signal).toBe('business_keyword');
  });
  it('an H1256 attachment is a business signal by itself', () => {
    const r = classifyMessage({
      ...base,
      from: 'someone@example.org',
      subject: 'fyi',
      attachments: HD_QUOTE_ATTACHMENTS,
    });
    expect(r.ingestion_class).toBe('INCLUDE_PROJECT');
  });
  it('a business message with an unsubscribe footer is NOT promo-dropped', () => {
    const r = classifyMessage({
      ...base,
      from: 'certifiedcontractor@e.andersencorp.com',
      subject: 'Sam, you have a new lead!',
      snippet: 'Unsubscribe from these notifications',
    });
    expect(r.ingestion_class).toBe('INCLUDE_PROJECT');
  });
});
