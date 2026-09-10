// Phase 1 Lane B - deterministic document classifier.
//
// Pure rules over metadata (filename, mime, source, sender domain, subject,
// folder path). No model call, no network. Output is a PROPOSAL: the
// registry treats 'low' confidence as never-current, and the authority
// classes proposed here never exceed what a third party or an internal
// draft can claim (OFFICIAL_CURRENT / OWNER_RULED_CURRENT are owner
// rulings and are never emitted by this module).
//
// External fields are DATA (CLAUDE.md rule 12): matched by regex only.

import type {
  AuthorityClass,
  Classification,
  Confidence,
  DocumentType,
  PrivacyClass,
  SourceSystem,
} from './types';

export interface ClassifyInput {
  filename: string;
  mimeType?: string;
  sourceSystem: SourceSystem;
  senderDomain?: string;
  subject?: string;
  folderPath?: string;
}

// Alternation builder so every vocabulary list stays one term per line.
function alt(...terms: string[]): RegExp {
  return new RegExp(`(${terms.join('|')})`);
}

const SYSTEM_FILE_RE = alt(
  '^~\\$', '^\\.~lock', '\\.tmp$', '\\.bak$', '\\.crdownload$', '\\.part$',
  '^\\.ds_store$', '^thumbs\\.db$', '^desktop\\.ini$', '\\.lnk$',
);
const HR_RE = alt(
  'payroll', 'w-?2\\b', 'w-?4\\b', 'i-?9\\b', '1099', 'paystub', 'pay stub',
  'timesheet', 'employee', 'hiring', 'termination', '\\bhr\\b',
  'human resources', 'background check',
);
const FINANCE_STATEMENT_RE = alt(
  'bank statement', 'statement\\b', 'tax return', '\\btax\\b', 'quickbooks',
  'ledger', '1040', 'ein\\b', 'credit card', 'card ending',
);
const RECEIPT_RE = alt(
  'receipt', 'invoice', 'payment received', 'deposit received',
  'paid in full', 'zelle', 'venmo', '\\bach\\b', 'wire transfer', 'check #',
  'balance due',
);
const HOME_DEPOT_REF_RE = /\bh\d{4}-\d{6}\b/;
const QUOTE_RE = alt('quote', 'quotation', 'estimate', 'pricing');
const PROPOSAL_RE = /proposal/;
const CONTRACT_RE = alt('contract', 'agreement', 'scope of work', '\\bsow\\b');
const PO_RE = alt('purchase order', '\\bpo[_ -]?\\d', '\\bpo\\b');
const ORDER_CONF_RE = alt(
  'order confirmation', 'order confirmed', 'confirmation of order',
  'sales order',
);
const DELIVERY_RE = alt(
  'delivery', 'delivered', 'bill of lading', '\\bbol\\b', 'shipping',
  'shipment', 'tracking',
);
const LPC_RE = alt(
  '\\blpc\\b', 'landmarks?\\b', '\\bdob\\b', 'certificate of no effect',
  '\\bcno\\b', 'permit', 'board approval', 'alteration agreement',
  'co-?op board', 'condo board', 'building approval',
);
const MEASURE_RE = alt(
  'measure', 'measurement', 'field dims', 'rough opening', '\\bro\\b',
);
const PLAN_RE = alt(
  'floor ?plan', 'elevation', 'drawing', 'blueprint', '\\bcad\\b',
  '\\bdwg\\b', 'schedule of openings', 'window schedule',
);
const DESIGN_RE = alt(
  'design', 'render', 'rendering', 'mockup', 'mood ?board',
  'finish selection',
);
const SPEC_RE = alt(
  'spec sheet', 'specification', 'spec\\b', 'data sheet', 'datasheet',
  'product data', 'nfrc', 'cut sheet',
);
const RFQ_RE = alt(
  'quote request', 'request for quote', '\\brfq\\b', 'pricing request',
);
const PUNCH_RE = alt('punch ?list', 'deficienc', 'touch-?up', 'service request');
const CLOSEOUT_RE = alt(
  'closeout', 'close-out', 'completion certificate', 'final walkthrough',
  'sign-?off',
);
const WARRANTY_RE = alt('warranty', 'guarantee');
const INTAKE_RE = alt('intake', 'inquiry', 'lead form', 'questionnaire',
  'new lead');
const KNOWLEDGE_RE = alt(
  'installation guide', 'install guide', 'manual', 'handbook',
  'product catalog', 'catalog', 'training',
);
const INSTALL_PATH_RE = alt('install', '11 installation');
const SITE_PATH_RE = alt('site', '01 site photos', 'before', 'existing');
const HD_DOMAIN_RE = /(^|\.)homedepot\.com$/;
const ANDERSEN_DOMAIN_RE = /(^|\.)andersen(windows|corp)?\.com$/;
const DOCUSIGN_DOMAIN_RE = /(^|\.)docusign\.(net|com)$/;
const DOCUSIGN_COMPLETED_RE = alt('completed', 'signed', 'executed');
const IMAGE_MIME_RE = /^image\//;

function norm(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function result(
  document_type: DocumentType,
  privacy_class: PrivacyClass,
  authority_class: AuthorityClass,
  confidence: Confidence,
  reasons: string[],
  document_subtype?: string,
): Classification {
  const out: Classification = {
    document_type,
    privacy_class,
    authority_class,
    confidence,
    reasons,
  };
  if (document_subtype) out.document_subtype = document_subtype;
  return out;
}

// Rule order matters: exclusion and restriction gates first, then
// executed/third-party evidence, then project record types, then the
// weak media/folder heuristics, then the unknown fallback.
export function classifyDocument(input: ClassifyInput): Classification {
  const name = norm(input.filename);
  const mime = norm(input.mimeType);
  const domain = norm(input.senderDomain);
  const subject = norm(input.subject);
  const path = norm(input.folderPath);
  const text = `${name} ${subject}`;
  const textAndPath = `${text} ${path}`;

  if (SYSTEM_FILE_RE.test(name)) {
    return result('other', 'EXCLUDE', 'HISTORICAL', 'high',
      ['system or temporary file pattern']);
  }

  // Restriction gates: HR and finance stay out of general context
  // regardless of any other signal (plan 7.11 FINANCE-RESTRICTED).
  if (HR_RE.test(textAndPath)) {
    return result('other', 'RESTRICTED_HR', 'HISTORICAL', 'medium',
      ['hr or payroll vocabulary']);
  }
  if (FINANCE_STATEMENT_RE.test(textAndPath) && !RECEIPT_RE.test(text)) {
    return result('other', 'RESTRICTED_FINANCE', 'HISTORICAL', 'medium',
      ['finance statement or tax vocabulary']);
  }
  if (RECEIPT_RE.test(text)) {
    const strong = domain.length > 0 || /receipt|invoice/.test(name);
    return result('payment_receipt', 'RESTRICTED_FINANCE', 'PROJECT_RECORD',
      strong ? 'high' : 'medium', ['payment or receipt vocabulary']);
  }

  // DocuSign: completed envelope = client-executed contract.
  if (input.sourceSystem === 'docusign' || DOCUSIGN_DOMAIN_RE.test(domain)) {
    if (DOCUSIGN_COMPLETED_RE.test(text)) {
      return result('contract', 'CLIENT_CONFIDENTIAL', 'CLIENT_EXECUTED',
        'high', ['docusign source', 'completed or signed envelope']);
    }
    return result('contract', 'CLIENT_CONFIDENTIAL', 'PROJECT_RECORD',
      'medium', ['docusign source', 'envelope not marked completed']);
  }

  // Home Depot quote: H####-###### reference and/or homedepot.com.
  const hdDomain = HD_DOMAIN_RE.test(domain);
  const hdRef = HOME_DEPOT_REF_RE.test(text);
  if (hdDomain || hdRef) {
    const reasons: string[] = [];
    if (hdDomain) reasons.push('sender domain homedepot.com');
    if (hdRef) reasons.push('home depot quote reference pattern');
    if (QUOTE_RE.test(text) || mime === 'application/pdf') {
      reasons.push('quote vocabulary or pdf');
      return result('vendor_quote', 'CLIENT_CONFIDENTIAL',
        'THIRD_PARTY_REFERENCE', hdDomain && hdRef ? 'high' : 'medium',
        reasons, 'HOMEDEPOT');
    }
    if (ORDER_CONF_RE.test(text)) {
      return result('order_confirmation', 'CLIENT_CONFIDENTIAL',
        'THIRD_PARTY_REFERENCE', 'high',
        [...reasons, 'order confirmation vocabulary'], 'HOMEDEPOT');
    }
    if (DELIVERY_RE.test(text)) {
      return result('delivery', 'CLIENT_CONFIDENTIAL',
        'THIRD_PARTY_REFERENCE', 'medium',
        [...reasons, 'delivery vocabulary'], 'HOMEDEPOT');
    }
    return result('vendor_quote', 'CLIENT_CONFIDENTIAL',
      'THIRD_PARTY_REFERENCE', 'low', reasons, 'HOMEDEPOT');
  }
  if (ANDERSEN_DOMAIN_RE.test(domain)) {
    if (QUOTE_RE.test(text)) {
      return result('vendor_quote', 'CLIENT_CONFIDENTIAL',
        'THIRD_PARTY_REFERENCE', 'medium',
        ['sender domain andersen', 'quote vocabulary'], 'ANDERSEN');
    }
    if (KNOWLEDGE_RE.test(text) || SPEC_RE.test(text)) {
      return result('knowledge', 'INTERNAL_APPROVED',
        'THIRD_PARTY_REFERENCE', 'medium',
        ['sender domain andersen', 'product reference vocabulary'],
        'ANDERSEN');
    }
  }

  if (RFQ_RE.test(text)) {
    return result('quote_request', 'CLIENT_CONFIDENTIAL', 'PROJECT_RECORD',
      'medium', ['quote request vocabulary']);
  }
  if (PROPOSAL_RE.test(text)) {
    return result('proposal', 'CLIENT_CONFIDENTIAL', 'INTERNAL_APPROVED',
      'medium', ['proposal vocabulary']);
  }
  if (CONTRACT_RE.test(text)) {
    return result('contract', 'CLIENT_CONFIDENTIAL', 'PROJECT_RECORD',
      'medium', ['contract vocabulary without execution evidence']);
  }
  if (ORDER_CONF_RE.test(text)) {
    return result('order_confirmation', 'CLIENT_CONFIDENTIAL',
      'THIRD_PARTY_REFERENCE', 'medium', ['order confirmation vocabulary']);
  }
  if (PO_RE.test(text)) {
    return result('purchase_order', 'CLIENT_CONFIDENTIAL', 'PROJECT_RECORD',
      'medium', ['purchase order vocabulary']);
  }
  if (DELIVERY_RE.test(text)) {
    return result('delivery', 'CLIENT_CONFIDENTIAL', 'THIRD_PARTY_REFERENCE',
      'medium', ['delivery vocabulary']);
  }
  if (LPC_RE.test(text)) {
    return result('lpc_dob_building', 'CLIENT_CONFIDENTIAL',
      'THIRD_PARTY_REFERENCE', 'medium', ['lpc dob or building vocabulary']);
  }
  if (WARRANTY_RE.test(text)) {
    return result('warranty', 'CLIENT_CONFIDENTIAL', 'THIRD_PARTY_REFERENCE',
      'medium', ['warranty vocabulary']);
  }
  if (PUNCH_RE.test(text)) {
    return result('punch', 'CLIENT_CONFIDENTIAL', 'PROJECT_RECORD',
      'medium', ['punch list vocabulary']);
  }
  if (CLOSEOUT_RE.test(text)) {
    return result('closeout', 'CLIENT_CONFIDENTIAL', 'PROJECT_RECORD',
      'medium', ['closeout vocabulary']);
  }
  if (QUOTE_RE.test(text) && domain.length > 0 &&
    input.sourceSystem === 'gmail') {
    return result('vendor_quote', 'CLIENT_CONFIDENTIAL',
      'THIRD_PARTY_REFERENCE', 'low',
      ['quote vocabulary from unrecognized sender']);
  }
  if (MEASURE_RE.test(text)) {
    return result('measurement', 'CLIENT_CONFIDENTIAL', 'PROJECT_RECORD',
      'medium', ['measurement vocabulary']);
  }
  if (PLAN_RE.test(text) || mime === 'image/vnd.dwg') {
    return result('plan', 'CLIENT_CONFIDENTIAL', 'PROJECT_RECORD',
      'medium', ['plan or drawing vocabulary']);
  }
  if (DESIGN_RE.test(text)) {
    return result('design', 'CLIENT_CONFIDENTIAL', 'PROJECT_RECORD',
      'medium', ['design vocabulary']);
  }
  if (SPEC_RE.test(text)) {
    return result('product_spec', 'INTERNAL_APPROVED',
      'THIRD_PARTY_REFERENCE', 'medium', ['product spec vocabulary']);
  }
  if (KNOWLEDGE_RE.test(text)) {
    return result('knowledge', 'INTERNAL_APPROVED', 'THIRD_PARTY_REFERENCE',
      'medium', ['reference or manual vocabulary']);
  }
  if (INTAKE_RE.test(text)) {
    return result('intake', 'CLIENT_CONFIDENTIAL', 'PROJECT_RECORD',
      'medium', ['intake vocabulary']);
  }

  if (IMAGE_MIME_RE.test(mime)) {
    if (INSTALL_PATH_RE.test(textAndPath)) {
      return result('installation_photo', 'CLIENT_CONFIDENTIAL',
        'PROJECT_RECORD', 'medium', ['image in installation context']);
    }
    if (SITE_PATH_RE.test(textAndPath)) {
      return result('site_photo', 'CLIENT_CONFIDENTIAL', 'PROJECT_RECORD',
        'medium', ['image in site context']);
    }
    return result('site_photo', 'CLIENT_CONFIDENTIAL', 'PROJECT_RECORD',
      'low', ['image without context']);
  }

  return result('other', 'CLIENT_CONFIDENTIAL', 'PROJECT_RECORD', 'low',
    ['no matching rule']);
}

// Only medium/high classifications may become the current document
// without an owner ruling.
export function canAutoRegisterAsCurrent(c: Classification): boolean {
  return c.confidence !== 'low';
}
