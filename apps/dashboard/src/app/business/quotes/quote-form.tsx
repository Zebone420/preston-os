'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  submitQuoteDraft,
  type QuoteFormState,
} from '../actions';

// Quote-draft agent form (client component). useActionState keeps
// the owner's input on validation failure - nothing typed is ever
// discarded. Success redirects to the new draft. The submit button
// disables while pending (double-submit protection; the server
// generates a fresh idempotency key per submission).

export interface OptionItem {
  id: string;
  label: string;
}

const INITIAL: QuoteFormState = {
  status: 'idle',
  messages: [],
  values: {},
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded bg-purple-900 px-3 py-1.5 text-sm disabled:opacity-50"
    >
      {pending
        ? 'Drafting (simulation)...'
        : 'Run quote-draft agent (simulation)'}
    </button>
  );
}

export function QuoteForm({
  clients,
  leads,
  properties,
  quotes,
}: {
  clients: OptionItem[];
  leads: OptionItem[];
  properties: OptionItem[];
  quotes: OptionItem[];
}) {
  const [state, formAction] = useActionState(submitQuoteDraft, INITIAL);
  const v = (name: string) => state.values[name] ?? '';

  return (
    <form action={formAction} className="space-y-2 text-sm">
      {state.status === 'error' && (
        <div className="rounded bg-red-950 p-2 text-xs text-red-200">
          <p className="mb-1 font-medium">
            Draft not created - your input is kept below:
          </p>
          <ul className="ml-4 list-disc">
            {state.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-slate-400">Title *</span>
          <input
            name="title"
            defaultValue={v('title')}
            className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-400">Client *</span>
          <select
            name="client_id"
            defaultValue={v('client_id')}
            className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
          >
            <option value="">select client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          {clients.length === 0 && (
            <span className="text-xs text-amber-300">
              No clients yet - add one with the form below first.
            </span>
          )}
        </label>
        <label className="block">
          <span className="text-xs text-slate-400">Scope *</span>
          <select
            name="scope_type"
            defaultValue={v('scope_type') || 'installation'}
            className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
          >
            <option value="installation">
              installation (50/25/25)
            </option>
            <option value="product_only">product only (75/25)</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-400">Jurisdiction *</span>
          <select
            name="jurisdiction"
            defaultValue={v('jurisdiction') || 'NYC'}
            className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
          >
            <option value="NYC">NYC (8.875% tax)</option>
            <option value="NJ">
              NJ (6.625% - owner confirmation flagged)
            </option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-400">
            Link lead (optional)
          </span>
          <select
            name="lead_id"
            defaultValue={v('lead_id')}
            className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
          >
            <option value="">none</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-400">
            Link property (optional)
          </span>
          <select
            name="property_id"
            defaultValue={v('property_id')}
            className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
          >
            <option value="">none</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-400">
            New version of existing quote (optional - overrides
            title/client)
          </span>
          <select
            name="quote_id"
            defaultValue={v('quote_id')}
            className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
          >
            <option value="">no - create a new quote</option>
            {quotes.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-400">
            Quote-level fees ($)
          </span>
          <input
            name="quote_fees"
            inputMode="decimal"
            defaultValue={v('quote_fees')}
            className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs text-slate-400">
            Markup (V4 unverified - always flagged; value must match
            the selected mode)
          </span>
          <div className="mt-0.5 flex gap-2">
            <select
              name="markup_mode"
              defaultValue={v('markup_mode') || 'none'}
              className="w-1/2 rounded bg-slate-800 p-1.5"
            >
              <option value="none">none</option>
              <option value="percent_milli">percent</option>
              <option value="fixed_cents">fixed $</option>
            </select>
            <input
              name="markup_percent"
              placeholder="%"
              inputMode="decimal"
              defaultValue={v('markup_percent')}
              className="w-1/4 rounded bg-slate-800 p-1.5"
            />
            <input
              name="markup_fixed"
              placeholder="$"
              inputMode="decimal"
              defaultValue={v('markup_fixed')}
              className="w-1/4 rounded bg-slate-800 p-1.5"
            />
          </div>
        </label>
      </div>

      <div className="mt-2 text-xs text-slate-400">
        Line items (up to 5; quantity, material $ and - for
        installation - labor $ are required; missing data fails
        closed and is reported, never guessed)
      </div>
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="grid grid-cols-2 gap-1 sm:grid-cols-7">
          <input
            name={`item${i}_label`}
            placeholder={`opening ${i}`}
            defaultValue={v(`item${i}_label`)}
            className="rounded bg-slate-800 p-1.5"
          />
          <input
            name={`item${i}_description`}
            placeholder="description"
            defaultValue={v(`item${i}_description`)}
            className="rounded bg-slate-800 p-1.5 sm:col-span-2"
          />
          <input
            name={`item${i}_quantity`}
            placeholder="qty"
            inputMode="numeric"
            defaultValue={v(`item${i}_quantity`)}
            className="rounded bg-slate-800 p-1.5"
          />
          <input
            name={`item${i}_material`}
            placeholder="mat $"
            inputMode="decimal"
            defaultValue={v(`item${i}_material`)}
            className="rounded bg-slate-800 p-1.5"
          />
          <input
            name={`item${i}_labor`}
            placeholder="labor $"
            inputMode="decimal"
            defaultValue={v(`item${i}_labor`)}
            className="rounded bg-slate-800 p-1.5"
          />
          <input
            name={`item${i}_fees`}
            placeholder="fees $"
            inputMode="decimal"
            defaultValue={v(`item${i}_fees`)}
            className="rounded bg-slate-800 p-1.5"
          />
        </div>
      ))}

      <label className="block">
        <span className="text-xs text-slate-400">
          Exclusions (one per line)
        </span>
        <textarea
          name="exclusions"
          rows={2}
          defaultValue={v('exclusions')}
          className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
        />
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          name="st124"
          defaultChecked={v('st124') === 'on'}
        />
        Track ST-124 capital-improvement paperwork (no tax
        determination is made)
      </label>
      <SubmitButton />
      <p className="text-xs text-slate-500">
        Produces a draft + owner approval request. Never sends a
        quote, never creates an invoice, never updates external
        systems. execution_eligible stays false.
      </p>
    </form>
  );
}
