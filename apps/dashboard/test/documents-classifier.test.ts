// Lane B pins: deterministic classifier fixtures. All fixtures are
// SYNTHETIC; no real client data. External fields are data only.

import { describe, expect, it } from 'vitest';

import {
  canAutoRegisterAsCurrent,
  classifyDocument,
} from '../src/lib/business/documents/classifier';
import type { ClassifyInput } from '../src/lib/business/documents/classifier';
import {
  isAuthorityClass,
  isDocumentType,
  isPrivacyClass,
} from '../src/lib/business/documents/types';
import type { Classification } from '../src/lib/business/documents/types';

interface Fixture {
  name: string;
  input: ClassifyInput;
  expect: Partial<Classification>;
}

const FIXTURES: Fixture[] = [
  {
    name: 'home depot quote pdf from homedepot.com',
    input: {
      filename: 'Quote H1256-471919.pdf', mimeType: 'application/pdf',
      sourceSystem: 'gmail', senderDomain: 'homedepot.com',
      subject: 'Your Home Depot quote',
    },
    expect: {
      document_type: 'vendor_quote', privacy_class: 'CLIENT_CONFIDENTIAL',
      authority_class: 'THIRD_PARTY_REFERENCE', confidence: 'high',
      document_subtype: 'HOMEDEPOT',
    },
  },
  {
    name: 'home depot quote by reference only (drive upload)',
    input: {
      filename: 'H1256-471919 quote.pdf', mimeType: 'application/pdf',
      sourceSystem: 'drive',
    },
    expect: {
      document_type: 'vendor_quote', authority_class: 'THIRD_PARTY_REFERENCE',
      confidence: 'medium',
    },
  },
  {
    name: 'docusign completed envelope',
    input: {
      filename: 'Installation Agreement.pdf', sourceSystem: 'docusign',
      senderDomain: 'docusign.net', subject: 'Completed: Installation Agreement',
    },
    expect: {
      document_type: 'contract', privacy_class: 'CLIENT_CONFIDENTIAL',
      authority_class: 'CLIENT_EXECUTED', confidence: 'high',
    },
  },
  {
    name: 'docusign envelope sent but not completed',
    input: {
      filename: 'Installation Agreement.pdf', sourceSystem: 'gmail',
      senderDomain: 'docusign.net', subject: 'Please sign: Agreement',
    },
    expect: {
      document_type: 'contract', authority_class: 'PROJECT_RECORD',
      confidence: 'medium',
    },
  },
  {
    name: 'payment receipt is finance-restricted',
    input: {
      filename: 'Receipt 2026-08-01.pdf', sourceSystem: 'gmail',
      senderDomain: 'squareup.com', subject: 'Payment received',
    },
    expect: {
      document_type: 'payment_receipt', privacy_class: 'RESTRICTED_FINANCE',
      authority_class: 'PROJECT_RECORD', confidence: 'high',
    },
  },
  {
    name: 'vendor invoice is finance-restricted',
    input: {
      filename: 'Invoice 4471.pdf', sourceSystem: 'drive',
      folderPath: 'Old Drive/Vendors',
    },
    expect: {
      document_type: 'payment_receipt', privacy_class: 'RESTRICTED_FINANCE',
    },
  },
  {
    name: 'bank statement is finance-restricted, never a project record',
    input: {
      filename: 'Bank Statement March.pdf', sourceSystem: 'drive',
    },
    expect: { document_type: 'other', privacy_class: 'RESTRICTED_FINANCE' },
  },
  {
    name: 'payroll document is HR-restricted',
    input: {
      filename: 'Payroll summary Q2.xlsx', sourceSystem: 'drive',
      folderPath: 'Old Drive/Admin',
    },
    expect: { document_type: 'other', privacy_class: 'RESTRICTED_HR' },
  },
  {
    name: 'W-2 form is HR-restricted even with quote words in the subject',
    input: {
      filename: 'W-2 2025.pdf', sourceSystem: 'gmail',
      subject: 'quote for the crew',
    },
    expect: { privacy_class: 'RESTRICTED_HR' },
  },
  {
    name: 'proposal is an internal draft, never OFFICIAL_CURRENT',
    input: {
      filename: 'P26-0041_PROPOSAL_CLIENT_V03.pdf', sourceSystem: 'render',
    },
    expect: {
      document_type: 'proposal', privacy_class: 'CLIENT_CONFIDENTIAL',
      authority_class: 'INTERNAL_APPROVED', confidence: 'medium',
    },
  },
  {
    name: 'purchase order',
    input: { filename: 'PO_2231.pdf', sourceSystem: 'upload' },
    expect: {
      document_type: 'purchase_order', authority_class: 'PROJECT_RECORD',
    },
  },
  {
    name: 'order confirmation from home depot',
    input: {
      filename: 'Order confirmation.pdf', sourceSystem: 'gmail',
      senderDomain: 'homedepot.com', subject: 'Order Confirmation W123',
    },
    expect: {
      document_type: 'order_confirmation', document_subtype: 'HOMEDEPOT',
      confidence: 'high',
    },
  },
  {
    name: 'delivery / bill of lading',
    input: {
      filename: 'BOL 88112.pdf', sourceSystem: 'gmail',
      senderDomain: 'freightco.example', subject: 'Delivery scheduled',
    },
    expect: { document_type: 'delivery', authority_class: 'THIRD_PARTY_REFERENCE' },
  },
  {
    name: 'LPC certificate of no effect',
    input: {
      filename: 'LPC Certificate of No Effect.pdf', sourceSystem: 'gmail',
      senderDomain: 'lpc.nyc.gov',
    },
    expect: {
      document_type: 'lpc_dob_building',
      authority_class: 'THIRD_PARTY_REFERENCE',
    },
  },
  {
    name: 'measurement sheet',
    input: { filename: 'Final measure sheet.pdf', sourceSystem: 'upload' },
    expect: { document_type: 'measurement', confidence: 'medium' },
  },
  {
    name: 'floor plan drawing',
    input: { filename: 'Floor plan A-101.pdf', sourceSystem: 'drive' },
    expect: { document_type: 'plan' },
  },
  {
    name: 'product spec sheet',
    input: {
      filename: 'Andersen 400 Series spec sheet.pdf', sourceSystem: 'gmail',
      senderDomain: 'andersenwindows.com',
    },
    expect: { document_type: 'knowledge', document_subtype: 'ANDERSEN' },
  },
  {
    name: 'andersen quote',
    input: {
      filename: 'Quote 55912.pdf', sourceSystem: 'gmail',
      senderDomain: 'andersenwindows.com', subject: 'Your Andersen quote',
    },
    expect: { document_type: 'vendor_quote', document_subtype: 'ANDERSEN' },
  },
  {
    name: 'warranty document',
    input: { filename: 'Limited Warranty.pdf', sourceSystem: 'drive' },
    expect: { document_type: 'warranty' },
  },
  {
    name: 'punch list',
    input: { filename: 'Punch list.docx', sourceSystem: 'upload' },
    expect: { document_type: 'punch' },
  },
  {
    name: 'closeout',
    input: { filename: 'Closeout package.pdf', sourceSystem: 'upload' },
    expect: { document_type: 'closeout' },
  },
  {
    name: 'installation photo by folder context',
    input: {
      filename: 'IMG_2201.jpg', mimeType: 'image/jpeg', sourceSystem: 'drive',
      folderPath: 'Clients/X/11 Installation',
    },
    expect: { document_type: 'installation_photo', confidence: 'medium' },
  },
  {
    name: 'site photo by folder context',
    input: {
      filename: 'IMG_0007.heic', mimeType: 'image/heic', sourceSystem: 'drive',
      folderPath: 'Clients/X/01 Site Photos',
    },
    expect: { document_type: 'site_photo', confidence: 'medium' },
  },
  {
    name: 'image without context is low confidence',
    input: {
      filename: 'IMG_0008.jpg', mimeType: 'image/jpeg', sourceSystem: 'drive',
    },
    expect: { document_type: 'site_photo', confidence: 'low' },
  },
  {
    name: 'temp file is excluded',
    input: { filename: '~$Proposal draft.docx', sourceSystem: 'drive' },
    expect: { privacy_class: 'EXCLUDE', confidence: 'high' },
  },
  {
    name: 'system file is excluded',
    input: { filename: '.DS_Store', sourceSystem: 'drive' },
    expect: { privacy_class: 'EXCLUDE' },
  },
  {
    name: 'unknown file falls back to other / low',
    input: { filename: 'zzz.bin', sourceSystem: 'drive' },
    expect: { document_type: 'other', confidence: 'low' },
  },
];

describe('classifyDocument fixtures', () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      const out = classifyDocument(f.input);
      expect(out).toMatchObject(f.expect);
      expect(isDocumentType(out.document_type)).toBe(true);
      expect(isPrivacyClass(out.privacy_class)).toBe(true);
      expect(isAuthorityClass(out.authority_class)).toBe(true);
      expect(out.reasons.length).toBeGreaterThan(0);
    });
  }

  it('is deterministic and never proposes an owner-ruled authority', () => {
    for (const f of FIXTURES) {
      const a = classifyDocument(f.input);
      const b = classifyDocument(f.input);
      expect(a).toEqual(b);
      expect(['OFFICIAL_CURRENT', 'OWNER_RULED_CURRENT', 'SUPERSEDED'])
        .not.toContain(a.authority_class);
    }
  });

  it('only medium/high confidence may auto-register as current', () => {
    expect(canAutoRegisterAsCurrent(classifyDocument({
      filename: 'zzz.bin', sourceSystem: 'drive',
    }))).toBe(false);
    expect(canAutoRegisterAsCurrent(classifyDocument({
      filename: 'PO_1.pdf', sourceSystem: 'upload',
    }))).toBe(true);
  });

  it('covers at least 12 synthetic cases including finance and HR', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(12);
    const privs = FIXTURES.map((f) => classifyDocument(f.input).privacy_class);
    expect(privs).toContain('RESTRICTED_FINANCE');
    expect(privs).toContain('RESTRICTED_HR');
  });
});
