// Preston AI OS - Phase 3 internal deterministic business runner adapter
// (provider 'preston.business'). Executes the INTERNAL capabilities purely
// in-process: proposal render, vendor quote parse, vendor quote reconcile,
// IQ+ report ingest. No credential, no network - it still runs through the
// sandbox credential gate so its evidence carries the same sandbox proof.

import type { CapabilityAdapter } from '../executor';
import type { CredentialBroker } from '../credentials';
import {
  BUSINESS_PROVIDER,
  CONTRACT_PACKAGE_RENDER,
  IQPLUS_REPORT_INGEST,
  PO_DOCUMENT_RENDER,
  PROPOSAL_DOCUMENT_RENDER,
  VENDOR_QUOTE_PARSE,
  VENDOR_QUOTE_RECONCILE,
} from '../business/definitions';
import {
  ProposalRenderParamsSchema,
  VendorQuoteParseParamsSchema,
  VendorQuoteReconcileParamsSchema,
  IqplusIngestParamsSchema,
  ContractPackageRenderParamsSchema,
  PoDocumentRenderParamsSchema,
  parseWith,
} from '../business/schemas';
import { renderProposal } from '../business/proposal-render';
import { parseVendorQuoteText } from '../business/vendor-quote-parse';
import { reconcileVendorQuote } from '../business/vendor-quote-reconcile';
import { ingestIqplusReport } from '../business/iqplus-ingest';
import { renderContractPackage } from '../business/contract-package-render';
import { renderPoDocument } from '../business/po-document-render';
import { makeNoCredentialBroker } from './sandbox-credentials';
import { sandboxCredentialGate, sandboxOk } from './sandbox-common';
import type { AdapterOutcome } from '../executor';

export function makeInternalRunnerAdapter(
  broker: CredentialBroker = makeNoCredentialBroker(),
): CapabilityAdapter {
  return {
    async execute(input): Promise<AdapterOutcome> {
      const gate = sandboxCredentialGate(broker, BUSINESS_PROVIDER);
      if (gate) return gate;
      const def = input.definition;
      if (def.provider !== BUSINESS_PROVIDER || def.enabled !== true || !def.validate_params) {
        return { status: 'terminal', reason: 'runner_capability_not_handled' };
      }
      const pv = def.validate_params(input.request.params);
      if (!pv.ok) return { status: 'terminal', reason: pv.reason };
      const params = input.request.params;
      const attempt = input.attempt;

      if (def.name === PROPOSAL_DOCUMENT_RENDER) {
        const p = parseWith(ProposalRenderParamsSchema, params);
        if (!p.ok) return { status: 'terminal', reason: p.reason };
        const r = renderProposal(p.data);
        return sandboxOk({ capability: def.name, canonical: pv.canonical, attempt,
          extra: { descriptor: r.descriptor, rendered_text: r.rendered_text } });
      }
      if (def.name === VENDOR_QUOTE_PARSE) {
        const p = parseWith(VendorQuoteParseParamsSchema, params);
        if (!p.ok) return { status: 'terminal', reason: p.reason };
        const parsed = parseVendorQuoteText(p.data.quote_text, p.data.client_contacts ?? []);
        return sandboxOk({ capability: def.name, canonical: pv.canonical, attempt,
          extra: { vendor_quote: parsed } });
      }
      if (def.name === VENDOR_QUOTE_RECONCILE) {
        const p = parseWith(VendorQuoteReconcileParamsSchema, params);
        if (!p.ok) return { status: 'terminal', reason: p.reason };
        const report = reconcileVendorQuote(p.data.vendor_quote, p.data.requested_spec);
        return sandboxOk({ capability: def.name, canonical: pv.canonical, attempt,
          extra: { reconciliation: report } });
      }
      if (def.name === IQPLUS_REPORT_INGEST) {
        const p = parseWith(IqplusIngestParamsSchema, params);
        if (!p.ok) return { status: 'terminal', reason: p.reason };
        const ingest = ingestIqplusReport(p.data.report_text, p.data.client_contacts ?? []);
        if (!ingest.ok) return { status: 'terminal', reason: ingest.reason };
        return sandboxOk({ capability: def.name, canonical: pv.canonical, attempt,
          extra: { report: ingest.report } });
      }
      if (def.name === CONTRACT_PACKAGE_RENDER) {
        const p = parseWith(ContractPackageRenderParamsSchema, params);
        if (!p.ok) return { status: 'terminal', reason: p.reason };
        const rendered = renderContractPackage(p.data);
        return sandboxOk({ capability: def.name, canonical: pv.canonical, attempt,
          extra: { descriptor: rendered.descriptor, rendered_text: rendered.rendered_text } });
      }
      if (def.name === PO_DOCUMENT_RENDER) {
        const p = parseWith(PoDocumentRenderParamsSchema, params);
        if (!p.ok) return { status: 'terminal', reason: p.reason };
        const rendered = renderPoDocument(p.data);
        return sandboxOk({ capability: def.name, canonical: pv.canonical, attempt,
          extra: { descriptor: rendered.descriptor, rendered_text: rendered.rendered_text } });
      }
      return { status: 'terminal', reason: 'runner_capability_not_handled' };
    },
  };
}
