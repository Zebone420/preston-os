'use client';

// Preston AI OS - Phase 7 goal form dynamic task rows. CLIENT-SIDE row
// management ONLY: rows are named sequentially by visible position, so
// the submitted field contract (task1_* .. task6_*) and the server-side
// parser, decomposition, classification, and approval enforcement are
// all unchanged and remain authoritative. The row/dependency logic is
// in exported PURE helpers so the behavior is unit-testable without a
// DOM environment; the component is a thin shell over them.

import { useState } from 'react';

export const MAX_TASK_ROWS = 6;

export const KIND_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Select work type' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'code', label: 'Code' },
  { value: 'test', label: 'Test' },
  { value: 'migration', label: 'Migration - owner approval required' },
  { value: 'audit', label: 'Audit' },
  { value: 'repair', label: 'Repair' },
  { value: 'recommendation', label: 'Recommendation' },
  { value: 'unknown', label: 'Unknown' },
];

export interface TaskRowState {
  kind: string;
  title: string;
  objective: string;
  depends: string;
}

export function emptyRow(): TaskRowState {
  return { kind: '', title: '', objective: '', depends: '' };
}

export function initialRows(): TaskRowState[] {
  return [emptyRow()];
}

// Add one row; refuses silently past the parser-supported maximum.
export function addRow(rows: TaskRowState[]): TaskRowState[] {
  if (rows.length >= MAX_TASK_ROWS) return rows;
  return [...rows, emptyRow()];
}

// Dependency tokens are 1-based visible row numbers ("1,2"). Non-numeric
// tokens pass through untouched - the server-side validation rejects
// them authoritatively.
function tokens(depends: string): string[] {
  return depends.split(',').map((s) => s.trim()).filter(Boolean);
}

export interface RemoveResult {
  rows: TaskRowState[];
  // 1-based visible numbers (AFTER re-numbering) of rows whose reference
  // to the removed row was cleared, for the validation notice.
  clearedFrom: number[];
}

// Remove the row at `index` (0-based). Row 1 (index 0) can never be
// removed. Remaining rows re-number consecutively; dependency tokens
// referencing rows after the removed one shift down by one, and tokens
// referencing the REMOVED row are cleared (never silently re-pointed).
export function removeRow(rows: TaskRowState[], index: number): RemoveResult {
  if (index <= 0 || index >= rows.length) return { rows, clearedFrom: [] };
  const removedNumber = index + 1;
  const kept = rows.filter((_, i) => i !== index);
  const clearedFrom: number[] = [];
  const next = kept.map((row, i) => {
    const mapped: string[] = [];
    let cleared = false;
    for (const t of tokens(row.depends)) {
      const n = Number(t);
      if (!Number.isInteger(n) || String(n) !== t) {
        mapped.push(t); // non-numeric: server rejects
        continue;
      }
      if (n === removedNumber) { cleared = true; continue; }
      mapped.push(n > removedNumber ? String(n - 1) : String(n));
    }
    if (cleared) clearedFrom.push(i + 1);
    return { ...row, depends: mapped.join(',') };
  });
  return { rows: next, clearedFrom };
}

// Client-side advisory validation (server stays authoritative): a task
// may not depend on itself or on a row that does not exist.
export function depIssues(rows: TaskRowState[]): string[] {
  const issues: string[] = [];
  rows.forEach((row, i) => {
    const self = i + 1;
    for (const t of tokens(row.depends)) {
      const n = Number(t);
      if (!Number.isInteger(n) || String(n) !== t) continue;
      if (n === self) issues.push(`task ${self} cannot depend on itself`);
      else if (n < 1 || n > rows.length) {
        issues.push(`task ${self} depends on row ${n}, which does not exist`);
      }
    }
  });
  return issues;
}

export function TaskRows() {
  const [rows, setRows] = useState<TaskRowState[]>(initialRows);
  const [notice, setNotice] = useState('');

  const set = (i: number, field: keyof TaskRowState, value: string) => {
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [field]: value } : row)));
  };
  const onAdd = () => { setRows((r) => addRow(r)); setNotice(''); };
  const onRemove = (i: number) => {
    setRows((r) => {
      const res = removeRow(r, i);
      setNotice(
        res.clearedFrom.length > 0
          ? `Cleared dependency on the removed task from task ${res.clearedFrom.join(', task ')} - please review.`
          : '',
      );
      return res.rows;
    });
  };
  const issues = depIssues(rows);

  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-500">Some work types may require owner approval before execution.</div>
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-5 gap-1">
          <select
            name={`task${i + 1}_kind`}
            aria-label={`Task ${i + 1} kind`}
            value={row.kind}
            onChange={(e) => set(i, 'kind', e.target.value)}
            className="rounded bg-slate-800 p-1.5"
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <input
            name={`task${i + 1}_title`}
            aria-label={`Task ${i + 1} title`}
            placeholder="title"
            value={row.title}
            onChange={(e) => set(i, 'title', e.target.value)}
            className="rounded bg-slate-800 p-1.5"
          />
          <input
            name={`task${i + 1}_objective`}
            aria-label={`Task ${i + 1} objective`}
            placeholder="objective"
            value={row.objective}
            onChange={(e) => set(i, 'objective', e.target.value)}
            className="rounded bg-slate-800 p-1.5"
          />
          <input
            name={`task${i + 1}_depends`}
            aria-label={`Task ${i + 1} dependencies`}
            placeholder="deps e.g. 1"
            value={row.depends}
            onChange={(e) => set(i, 'depends', e.target.value)}
            className="rounded bg-slate-800 p-1.5"
          />
          {i > 0 ? (
            <button
              type="button"
              aria-label={`Remove task ${i + 1}`}
              onClick={() => onRemove(i)}
              className="rounded bg-slate-800 px-2 py-1.5 text-xs text-slate-300"
            >
              Remove
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
        </div>
      ))}
      {rows.length < MAX_TASK_ROWS && (
        <button
          type="button"
          aria-label="Add task"
          onClick={onAdd}
          className="rounded bg-slate-800 px-3 py-1.5 text-xs text-slate-300"
        >
          Add task
        </button>
      )}
      <div aria-live="polite" className="text-xs text-amber-400">
        {[notice, ...issues].filter(Boolean).join(' ')}
      </div>
    </div>
  );
}
