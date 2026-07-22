import { describe, expect, it } from 'vitest';
import {
  buildPaymentSchedule,
  calculateQuote,
  FLAG_MARGIN_EQUALS_MARKUP,
  FLAG_MARKUP_UNVERIFIED,
  FLAG_NJ_TAX_PENDING,
  FLAG_SIMULATION_DRAFT,
  FLAG_ST124_TRACKING_ONLY,
  mulDivRoundHalfUp,
  validateQuoteEngineInput,
  type QuoteEngineInput,
} from '../src/lib/business/quote-engine';

const NYC_INSTALL: QuoteEngineInput = {
  scope_type: 'installation',
  jurisdiction: 'NYC',
  quote_fees_cents: 20000,
  items: [
    {
      opening_label: 'W1-W3',
      description: 'double-hung windows',
      quantity: 3,
      unit_material_cents: 120000,
      unit_labor_cents: 45000,
    },
    {
      opening_label: 'D1',
      description: 'entry door',
      quantity: 1,
      unit_material_cents: 250000,
      unit_labor_cents: 80000,
      line_fees_cents: 5000,
    },
  ],
};

describe('mulDivRoundHalfUp', () => {
  it('rounds half up at the exact .5 boundary', () => {
    // 400 * 8875 / 100000 = 35.5 exactly -> 36
    expect(mulDivRoundHalfUp(400, 8875, 100000)).toBe(36);
    // 200 * 8875 / 100000 = 17.75 -> 18
    expect(mulDivRoundHalfUp(200, 8875, 100000)).toBe(18);
    // 100 * 8875 / 100000 = 8.875 -> 9
    expect(mulDivRoundHalfUp(100, 8875, 100000)).toBe(9);
    // above half rounds up: 100 * 6625 / 100000 = 6.625 -> 7
    expect(mulDivRoundHalfUp(100, 6625, 100000)).toBe(7);
    // exact values stay exact: 100 * 4000 / 100000 = 4.0 -> 4
    expect(mulDivRoundHalfUp(100, 4000, 100000)).toBe(4);
    // below half stays down: 100 * 4400 / 100000 = 4.4 -> 4
    expect(mulDivRoundHalfUp(100, 4400, 100000)).toBe(4);
    expect(mulDivRoundHalfUp(1, 1, 3)).toBe(0);
    expect(mulDivRoundHalfUp(1, 1, 2)).toBe(1);
  });

  it('throws when the product leaves the safe-integer range', () => {
    expect(() =>
      mulDivRoundHalfUp(Number.MAX_SAFE_INTEGER, 3, 10),
    ).toThrow(/bounds/);
  });
});

describe('calculateQuote - NYC installation (owner-ruled V2 math)', () => {
  it('computes every component exactly (hand-verified)', () => {
    const q = calculateQuote(NYC_INSTALL);
    expect(q.material_cents).toBe(610000);
    expect(q.labor_cents).toBe(215000);
    expect(q.fees_cents).toBe(25000);
    expect(q.markup_cents).toBe(0);
    expect(q.subtotal_cents).toBe(850000);
    // 850000 * 8875 / 100000 = 75437.5 -> half-up 75438
    expect(q.tax_cents).toBe(75438);
    expect(q.total_cents).toBe(925438);
    expect(q.tax_rate_milli_pct).toBe(8875);
    expect(q.margin_cents).toBe(0);
  });

  it('matches the owner-ruled 1.08875 multiplier to the cent', () => {
    const q = calculateQuote(NYC_INSTALL);
    const expected = Math.round(q.subtotal_cents * 1.08875);
    expect(q.total_cents).toBe(expected);
  });

  it('splits 50/25/25 with the remainder on the final stage', () => {
    const q = calculateQuote(NYC_INSTALL);
    const s = q.payment_schedule;
    expect(s.schedule_type).toBe('installation_50_25_25');
    expect(s.stages.map((x) => x.label)).toEqual([
      'deposit',
      'before_installation',
      'at_completion',
    ]);
    expect(s.stages[0].amount_cents).toBe(462719);
    expect(s.stages[1].amount_cents).toBe(231360);
    expect(s.stages[2].amount_cents).toBe(231359);
    const sum = s.stages.reduce((a, x) => a + x.amount_cents, 0);
    expect(sum).toBe(q.total_cents);
  });

  it('computes each line total correctly (qty applies to both costs)', () => {
    const q = calculateQuote(NYC_INSTALL);
    // 3 * (120000 + 45000) + 0 fees
    expect(q.items[0].line_total_cents).toBe(495000);
    // 1 * (250000 + 80000) + 5000 fees
    expect(q.items[1].line_total_cents).toBe(335000);
    const sum = q.items.reduce((a, it) => a + it.line_total_cents, 0);
    expect(sum).toBe(
      q.material_cents +
        q.labor_cents +
        (q.fees_cents - (NYC_INSTALL.quote_fees_cents ?? 0)),
    );
  });

  it('exposes material, labor, fees, tax, total, margin separately', () => {
    const q = calculateQuote(NYC_INSTALL);
    for (const key of [
      'material_cents',
      'labor_cents',
      'fees_cents',
      'markup_cents',
      'subtotal_cents',
      'tax_cents',
      'total_cents',
      'margin_cents',
    ] as const) {
      expect(typeof q[key]).toBe('number');
      expect(Number.isSafeInteger(q[key])).toBe(true);
    }
  });
});

describe('calculateQuote - product-only and NJ', () => {
  const NJ_PRODUCT: QuoteEngineInput = {
    scope_type: 'product_only',
    jurisdiction: 'NJ',
    items: [{ quantity: 2, unit_material_cents: 500000 }],
    markup_mode: 'fixed_cents',
    markup_value: 100000,
  };

  it('computes NJ product-only totals exactly', () => {
    const q = calculateQuote(NJ_PRODUCT);
    expect(q.material_cents).toBe(1000000);
    expect(q.labor_cents).toBe(0);
    expect(q.markup_cents).toBe(100000);
    expect(q.subtotal_cents).toBe(1100000);
    // 1100000 * 6625 / 100000 = 72875 exactly
    expect(q.tax_cents).toBe(72875);
    expect(q.total_cents).toBe(1172875);
    expect(q.margin_cents).toBe(100000);
  });

  it('splits 75/25 with the remainder on the final stage', () => {
    const q = calculateQuote(NJ_PRODUCT);
    const s = q.payment_schedule;
    expect(s.schedule_type).toBe('product_only_75_25');
    expect(s.stages[0].amount_cents).toBe(879656);
    expect(s.stages[1].amount_cents).toBe(293219);
    expect(s.stages[0].amount_cents + s.stages[1].amount_cents).toBe(
      q.total_cents,
    );
  });

  it('flags NJ tax as pending register ruling and markup unverified', () => {
    const q = calculateQuote(NJ_PRODUCT);
    expect(q.assumptions).toContain(FLAG_NJ_TAX_PENDING);
    expect(q.assumptions).toContain(FLAG_MARKUP_UNVERIFIED);
    expect(q.owner_confirmation_required).toBe(true);
  });

  it('percent markup uses milli-percent over 100000', () => {
    const q = calculateQuote({
      ...NYC_INSTALL,
      markup_mode: 'percent_milli',
      markup_value: 25000, // 25 percent
    });
    // base 850000 * 25 percent = 212500
    expect(q.markup_cents).toBe(212500);
    expect(q.subtotal_cents).toBe(1062500);
    expect(q.margin_cents).toBe(212500);
  });
});

describe('calculateQuote - flags and simulation posture', () => {
  it('always carries simulation and margin-model flags', () => {
    const q = calculateQuote(NYC_INSTALL);
    expect(q.assumptions).toContain(FLAG_SIMULATION_DRAFT);
    expect(q.assumptions).toContain(FLAG_MARGIN_EQUALS_MARKUP);
    expect(q.owner_confirmation_required).toBe(true);
  });

  it('never applies a default markup (V4 deferred)', () => {
    const q = calculateQuote(NYC_INSTALL);
    expect(q.markup_cents).toBe(0);
    expect(q.assumptions).not.toContain(FLAG_MARKUP_UNVERIFIED);
  });

  it('passes ST-124 tracking through without a determination', () => {
    const q = calculateQuote({
      ...NYC_INSTALL,
      st124_tracking: { st124_claimed: 'owner_to_review' },
    });
    expect(q.assumptions).toContain(FLAG_ST124_TRACKING_ONLY);
    expect(q.st124_tracking).toEqual({
      st124_claimed: 'owner_to_review',
    });
    // ST-124 never changes the math in V1.
    expect(q.tax_cents).toBe(calculateQuote(NYC_INSTALL).tax_cents);
  });
});

describe('calculateQuote - determinism', () => {
  it('identical input produces identical output (deep equal)', () => {
    const a = calculateQuote(NYC_INSTALL);
    const b = calculateQuote(NYC_INSTALL);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('holds across 200 seeded pseudo-random inputs', () => {
    // Deterministic LCG so the test itself is reproducible.
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let i = 0; i < 200; i++) {
      const input: QuoteEngineInput = {
        scope_type: next() % 2 === 0 ? 'installation' : 'product_only',
        jurisdiction: next() % 2 === 0 ? 'NYC' : 'NJ',
        quote_fees_cents: next() % 100000,
        items: [
          {
            quantity: (next() % 20) + 1,
            unit_material_cents: next() % 1000000,
            ...(seed % 2 === 0 ? {} : { line_fees_cents: next() % 5000 }),
          },
        ],
      };
      if (input.scope_type === 'installation') {
        input.items![0].unit_labor_cents = next() % 500000;
      }
      const a = calculateQuote(input);
      const b = calculateQuote(input);
      expect(a).toEqual(b);
      const stageSum = a.payment_schedule.stages.reduce(
        (acc, s) => acc + s.amount_cents,
        0,
      );
      expect(stageSum).toBe(a.total_cents);
      expect(a.subtotal_cents + a.tax_cents).toBe(a.total_cents);
    }
  });
});

describe('validateQuoteEngineInput - fail-closed behavior', () => {
  it('reports missing material inputs instead of guessing', () => {
    const v = validateQuoteEngineInput({
      scope_type: 'installation',
      jurisdiction: 'NYC',
      items: [{ quantity: 2 }],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.missing_fields).toContain(
        'items[0].unit_material_cents',
      );
      expect(v.missing_fields).toContain('items[0].unit_labor_cents');
    }
  });

  it('reports all top-level missing fields', () => {
    const v = validateQuoteEngineInput({});
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.missing_fields).toEqual(
        expect.arrayContaining(['scope_type', 'jurisdiction', 'items']),
      );
    }
  });

  it('rejects unsupported jurisdictions outright', () => {
    const v = validateQuoteEngineInput({
      scope_type: 'installation',
      jurisdiction: 'CT',
      items: [
        {
          quantity: 1,
          unit_material_cents: 1000,
          unit_labor_cents: 1000,
        },
      ],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors).toContain('jurisdiction_unsupported');
    }
  });

  it('rejects labor on product-only scope', () => {
    const v = validateQuoteEngineInput({
      scope_type: 'product_only',
      jurisdiction: 'NYC',
      items: [
        { quantity: 1, unit_material_cents: 1000, unit_labor_cents: 5 },
      ],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors).toContain(
        'items[0].labor_not_allowed_product_only',
      );
    }
  });

  it('rejects non-integer, negative, and oversized money', () => {
    for (const bad of [12.5, -1, Number.MAX_SAFE_INTEGER]) {
      const v = validateQuoteEngineInput({
        scope_type: 'product_only',
        jurisdiction: 'NYC',
        items: [{ quantity: 1, unit_material_cents: bad }],
      });
      expect(v.ok).toBe(false);
    }
  });

  it('rejects markup above 100 percent and value-without-mode', () => {
    const over = validateQuoteEngineInput({
      scope_type: 'product_only',
      jurisdiction: 'NYC',
      items: [{ quantity: 1, unit_material_cents: 1000 }],
      markup_mode: 'percent_milli',
      markup_value: 100001,
    });
    expect(over.ok).toBe(false);
    const orphan = validateQuoteEngineInput({
      scope_type: 'product_only',
      jurisdiction: 'NYC',
      items: [{ quantity: 1, unit_material_cents: 1000 }],
      markup_value: 5000,
    });
    expect(orphan.ok).toBe(false);
  });

  it('calculateQuote throws rather than pricing invalid input', () => {
    expect(() =>
      calculateQuote({ scope_type: 'installation' }),
    ).toThrow(/invalid input/);
  });

  it('rejects per-field-valid inputs whose totals exceed the bound', () => {
    // Each field passes its own check, but the aggregate would
    // overflow the supported money range: named validation error,
    // not an internal engine throw.
    const v = validateQuoteEngineInput({
      scope_type: 'product_only',
      jurisdiction: 'NYC',
      items: Array.from({ length: 3 }, () => ({
        quantity: 10000,
        unit_material_cents: 50_000_000_000,
      })),
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors).toContain('totals_exceed_supported_bounds');
    }
  });
});

describe('buildPaymentSchedule - exact splits on odd totals', () => {
  it('always sums to the total (odd cents)', () => {
    for (const total of [0, 1, 2, 3, 101, 999, 925437, 925439]) {
      for (const scope of ['installation', 'product_only'] as const) {
        const plan = buildPaymentSchedule(scope, total);
        const sum = plan.stages.reduce(
          (a, s) => a + s.amount_cents,
          0,
        );
        expect(sum).toBe(total);
      }
    }
  });

  it('101 cents installation splits 51/25/25', () => {
    const plan = buildPaymentSchedule('installation', 101);
    expect(plan.stages.map((s) => s.amount_cents)).toEqual([
      51, 25, 25,
    ]);
  });
});
