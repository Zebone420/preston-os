// Business Command Center page data loader (Phase 6D).
//
// Connected mode: reads every business surface through the
// RLS-bound owner client; per-table errors degrade to empty lists
// with visible error notes (never fabricated data).
// Setup mode (Supabase unconfigured): serves the deterministic
// fixture dataset, clearly labeled by the UI as fixture data.

import type { RuntimeClient } from '../ai-os/store';
import {
  resolveOwner,
  type OwnerContext,
} from '../ai-os/owner-context';
import { isAuthConfigured } from '../owner-auth';
import {
  BUSINESS_TABLES,
  listBusinessRows,
} from './business-store';
import { buildFixtureDataset } from './fixtures';
import type { Row } from './read-models';

// Shared page-entry resolution: connected mode requires the owner;
// unconfigured (setup) mode renders labeled fixture data instead.
export async function resolveBusinessPageContext(): Promise<{
  needsLogin: boolean;
  ctx: OwnerContext | null;
}> {
  const configured = isAuthConfigured(process.env);
  const ctx = configured ? await resolveOwner() : null;
  return { needsLogin: configured && !ctx, ctx };
}

export interface BusinessData {
  mode: 'setup' | 'connected';
  clients: Row[];
  properties: Row[];
  leads: Row[];
  quotes: Row[];
  quoteVersions: Row[];
  quoteItems: Row[];
  projects: Row[];
  milestones: Row[];
  vendorOrders: Row[];
  installationEvents: Row[];
  paymentSchedules: Row[];
  paymentEvents: Row[];
  communications: Row[];
  recommendations: Row[];
  quoteDraftRuns: Row[];
  activity: Row[];
  approvals: Row[];
  approvalLinks: Row[];
  errors: string[];
}

function fixtureData(): BusinessData {
  const ds = buildFixtureDataset();
  const rows = (arr: object[]) => arr as unknown as Row[];
  return {
    mode: 'setup',
    clients: rows(ds.clients),
    properties: rows(ds.properties),
    leads: rows(ds.leads),
    quotes: rows(ds.quotes),
    quoteVersions: rows(ds.quoteVersions),
    quoteItems: rows(ds.quoteItems),
    projects: rows(ds.projects),
    milestones: rows(ds.milestones),
    vendorOrders: rows(ds.vendorOrders),
    installationEvents: rows(ds.installationEvents),
    paymentSchedules: rows(ds.paymentSchedules),
    paymentEvents: rows(ds.paymentEvents),
    communications: rows(ds.communications),
    recommendations: rows(ds.recommendations),
    quoteDraftRuns: rows(ds.quoteDraftRuns),
    activity: rows(ds.activityEvents),
    approvals: [],
    approvalLinks: [],
    errors: [],
  };
}

export async function loadBusinessData(
  client: RuntimeClient | null,
): Promise<BusinessData> {
  if (!client) return fixtureData();

  const errors: string[] = [];
  const read = async (
    table: string,
    opts?: Parameters<typeof listBusinessRows>[2],
  ): Promise<Row[]> => {
    const res = await listBusinessRows(client, table, opts);
    if (!res.ok && res.error) errors.push(`${table}: ${res.error}`);
    return res.rows;
  };

  const [
    clients,
    properties,
    leads,
    quotes,
    quoteVersions,
    quoteItems,
    projects,
    milestones,
    vendorOrders,
    installationEvents,
    paymentSchedules,
    paymentEvents,
    communications,
    recommendations,
    quoteDraftRuns,
    activity,
    approvals,
    approvalLinks,
  ] = await Promise.all([
    read(BUSINESS_TABLES.clients),
    read(BUSINESS_TABLES.properties),
    read(BUSINESS_TABLES.leads),
    read(BUSINESS_TABLES.quotes),
    read(BUSINESS_TABLES.quoteVersions),
    read(BUSINESS_TABLES.quoteItems, { limit: 500 }),
    read(BUSINESS_TABLES.projects),
    read(BUSINESS_TABLES.milestones, { limit: 500 }),
    read(BUSINESS_TABLES.vendorOrders),
    read(BUSINESS_TABLES.installationEvents),
    read(BUSINESS_TABLES.paymentSchedules),
    read(BUSINESS_TABLES.paymentEvents),
    read(BUSINESS_TABLES.communications),
    read(BUSINESS_TABLES.recommendations),
    read(BUSINESS_TABLES.quoteDraftRuns, { limit: 50 }),
    read(BUSINESS_TABLES.activity, { limit: 100 }),
    read(BUSINESS_TABLES.approvals, { limit: 100 }),
    read(BUSINESS_TABLES.approvalLinks, { limit: 200 }),
  ]);

  return {
    mode: 'connected',
    clients,
    properties,
    leads,
    quotes,
    quoteVersions,
    quoteItems,
    projects,
    milestones,
    vendorOrders,
    installationEvents,
    paymentSchedules,
    paymentEvents,
    communications,
    recommendations,
    quoteDraftRuns,
    activity,
    approvals,
    approvalLinks,
    errors,
  };
}
