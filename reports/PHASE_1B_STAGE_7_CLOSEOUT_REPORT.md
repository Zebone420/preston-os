# Phase 1B Stage 7 - Closeout Report

Status: CLOSEOUT. Files-only record of the Stage 7 dashboard data
mapping/polish gate. Read-only display change; no env, no SQL, no Airtable
writes, no production. Commit a64cfed.

## Goal

Move the dashboard cards from raw first-field / record-id display to
readable business fields, keyed by human field NAME (owner decision:
optimize for speed and readable staging code over field-id robustness).

## What shipped (commit a64cfed)

- apps/dashboard/src/lib/airtable.ts - read by field NAME (dropped the
  returnFieldsByFieldId=true flag; Airtable returns names by default).
  Still read-only; TEST-base guard and write-block unchanged.
- apps/dashboard/src/lib/cards.ts - per-card field-name priority lists
  (CARD_FIELDS), clean ISO date formatting (formatDateValue, pure string
  math - no Date, timezone/locale-stable), id-safe display (formatCell +
  isAirtableId strip rec/fld/app/tbl/viw values, including linked-record
  arrays), title fallback to first displayable value then "(untitled
  record)" - never a raw record id.
- apps/dashboard/src/app/page.tsx - render an optional detail line per card.
- apps/dashboard/test/airtable.test.ts - URL assertion flipped to name-based.
- apps/dashboard/test/cards-mapping.test.ts - NEW, 13 tests.

## Mappings (owner-supplied priority lists)

- Today:    title Type/Appointment Type/Subject/Name/Title;
            detail Date/Appointment Date/Start Time/Location/Address/Project
- Leads:    title Lead Name/Name/Client Name/Full Name/Address/Project Address;
            detail Status/Stage/Phone/Email/Source
- Projects: title Project Name/Name/Address/Project Address/Client Name;
            detail Status/Stage/Blocker/Next Step
- Quotes:   title Quote Name/Name/Client Name/Project Address/Address;
            detail Status/Quote Status/Date/Created/Total/Amount

Priority lists mean whichever candidate field exists is used - no live
Airtable read was needed. If real field names differ from all candidates a
card falls back rather than erroring; confirm via a dashboard screenshot and
tune the lists if needed.

## Before / after

- Before: firstText() showed an arbitrary first string field; no date
  formatting; fell back to the raw rec... id when no string field existed.
- After: meaningful title + optional detail; dates like 2026-07-15 render
  "Jul 15, 2026" and 2026-07-15T13:30:00Z render "Jul 15, 2026, 1:30 PM";
  id-shaped values never shown; "(untitled record)" when nothing displayable.
  Source labels (AIRTABLE TEST/DEV) and fail-closed-to-MOCK unchanged.

## Validation

vitest 129 passed (11 files); eslint exit 0; tsc --noEmit exit 0.
Test coverage: title selection, empty-field skip, date formatting (incl.
midnight/noon), fallback, no-raw-rec-id, id-shaped value filtering, array
join, missing/null field safety.

## Safety ledger

Production touched: false. Secrets exposed: false. Env changed: false.
SQL run: false. Airtable writes: false. Live messages/emails: false.

## Verdict

Stage 7 PASS (pending owner push + redeploy + screenshot confirmation of
real field-name matches). Closed.
