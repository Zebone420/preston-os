import { describe, expect, it } from 'vitest';
import { linkMessageToProject } from '../src/lib/business/comms/linker';
import { HD_QUOTE_ATTACHMENTS, INDEX, OWNER, PROJECT_A, PROJECT_B } from './comms-fixtures';

const msg = (over: Partial<Parameters<typeof linkMessageToProject>[0]>) => ({
  subject: 'hello',
  from: 'someone@example.org',
  to: [OWNER],
  ...over,
});

describe('linker - signal precedence', () => {
  it('1. project code in subject wins (linked_auto)', () => {
    const r = linkMessageToProject(
      msg({ subject: 'P26-0042 - site visit', threadId: 'thread-a' }),
      INDEX,
    );
    expect(r).toMatchObject({ project_id: PROJECT_B, link_confidence: 'linked_auto' });
    expect(r.link_signal).toBe('project_code:P26-0042');
  });
  it('1b. project code in an attachment filename', () => {
    const r = linkMessageToProject(
      msg({ attachments: [{ name: 'P26-0041 proposal.pdf', mime: 'application/pdf', size: 1 }] }),
      INDEX,
    );
    expect(r.project_id).toBe(PROJECT_A);
    expect(r.link_confidence).toBe('linked_auto');
  });
  it('2. known thread mapping', () => {
    const r = linkMessageToProject(msg({ threadId: 'thread-a' }), INDEX);
    expect(r).toMatchObject({ project_id: PROJECT_A, link_confidence: 'linked_auto' });
    expect(r.link_signal).toBe('thread:thread-a');
  });
  it('3. Home Depot case / quote number mapping', () => {
    const byCase = linkMessageToProject(msg({ subject: 'Case Submitted #12345678' }), INDEX);
    expect(byCase).toMatchObject({ project_id: PROJECT_A, link_confidence: 'linked_auto' });
    const byQuote = linkMessageToProject(
      msg({ subject: 'Your quote', attachments: HD_QUOTE_ATTACHMENTS }),
      INDEX,
    );
    expect(byQuote.link_signal).toBe('hd_ref:H1256-123456');
  });
  it('4. approved contact alias is only a candidate', () => {
    const r = linkMessageToProject(msg({ from: 'Jane <jane@example.com>' }), INDEX);
    expect(r).toMatchObject({ project_id: PROJECT_A, link_confidence: 'candidate' });
    expect(r.link_signal).toBe('contact_alias');
  });
  it('5. property address match is only a candidate', () => {
    const r = linkMessageToProject(
      msg({ subject: 'Re: 9 Example Avenue windows', bodyText: '' }),
      INDEX,
    );
    expect(r).toMatchObject({ project_id: PROJECT_B, link_confidence: 'candidate' });
    expect(r.link_signal).toBe('property_address');
  });
});

describe('linker - ambiguity and ladder', () => {
  it('two project codes -> orphan with a review reason', () => {
    const r = linkMessageToProject(msg({ subject: 'P26-0041 and P26-0042' }), INDEX);
    expect(r.link_confidence).toBe('orphan');
    expect(r.project_id).toBeNull();
    expect(r.review_reason).toMatch(/multiple project codes/);
  });
  it('contact alias mapped to several projects -> orphan', () => {
    const idx = { ...INDEX, contactAliases: { 'jane@example.com': [PROJECT_A, PROJECT_B] } };
    const r = linkMessageToProject(msg({ from: 'jane@example.com' }), idx);
    expect(r.link_confidence).toBe('orphan');
    expect(r.review_reason).toMatch(/several projects/);
  });
  it('unknown project code -> orphan flagged for review', () => {
    const r = linkMessageToProject(msg({ subject: 'P26-9999 question' }), INDEX);
    expect(r.link_confidence).toBe('orphan');
    expect(r.link_signal).toBe('project_code_unknown');
  });
  it('no signal -> orphan', () => {
    const r = linkMessageToProject(msg({}), INDEX);
    expect(r).toMatchObject({ project_id: null, link_confidence: 'orphan' });
  });
  it('never returns confirmed', () => {
    const inputs = [
      msg({ subject: 'P26-0041' }),
      msg({ threadId: 'thread-a' }),
      msg({ from: 'jane@example.com' }),
      msg({ subject: '12 Sample St' }),
    ];
    for (const i of inputs) {
      expect(linkMessageToProject(i, INDEX).link_confidence).not.toBe('confirmed');
    }
  });
  it('thread map pointing at an unknown project is ignored', () => {
    const idx = { ...INDEX, threadMap: { 'thread-a': 'not-a-project' } };
    const r = linkMessageToProject(msg({ threadId: 'thread-a' }), idx);
    expect(r.link_confidence).toBe('orphan');
  });
});
