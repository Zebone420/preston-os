// Lane B pins: standard Drive folder template (plan 5.2) and the pure
// new-project folder plan (plan 5.1). Nothing here touches Drive.

import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_TYPE_FOLDER,
  FOLDER_TEMPLATE_V1,
  FOLDER_TEMPLATE_VERSION,
  planNewProjectFolder,
  projectFolderName,
  sanitizeDisplaySegment,
  subfoldersComplete,
} from '../src/lib/business/documents/folder-template';
import { DOCUMENT_TYPES } from '../src/lib/business/documents/types';

describe('folder template v1', () => {
  it('has exactly the 14 plan 5.2 subfolders in order', () => {
    expect(FOLDER_TEMPLATE_VERSION).toBe(1);
    expect(FOLDER_TEMPLATE_V1).toEqual([
      '00 Intake',
      '01 Site Photos',
      '02 Measurements',
      '03 Plans & Design',
      '04 Product & Vendor',
      '05 Quotes & Proposals',
      '06 Contract',
      '07 Payments & Receipts',
      '08 LPC DOB & Building',
      '09 Purchase Order',
      '10 Order & Delivery',
      '11 Installation',
      '12 Punch & Closeout',
      '13 Warranty',
    ]);
    const prefixes = FOLDER_TEMPLATE_V1.map((n) => n.slice(0, 2));
    expect(prefixes).toEqual(prefixes.map((_, i) =>
      String(i).padStart(2, '0')));
  });

  it('maps every document type onto a template folder', () => {
    for (const t of DOCUMENT_TYPES) {
      expect(FOLDER_TEMPLATE_V1).toContain(DOCUMENT_TYPE_FOLDER[t]);
    }
  });
});

describe('projectFolderName', () => {
  it('formats code and address with an ASCII hyphen separator', () => {
    expect(projectFolderName('P26-0041', '123 W 78th St Apt 4A'))
      .toBe('P26-0041 - 123 W 78th St Apt 4A');
  });

  it('collapses whitespace and strips unsafe characters', () => {
    expect(projectFolderName('P26-0041', '  123  W/78th\\St:  Apt*4A? '))
      .toBe('P26-0041 - 123 W78thSt Apt4A');
    expect(sanitizeDisplaySegment('Smith, John & Jane (Apt #2)'))
      .toBe("Smith, John & Jane (Apt #2)");
  });

  it('rejects a bad project code or empty address', () => {
    expect(() => projectFolderName('26-0041', '1 Main St')).toThrow();
    expect(() => projectFolderName('P26-41', '1 Main St')).toThrow();
    expect(() => projectFolderName('P26-0041', '///')).toThrow();
  });
});

describe('planNewProjectFolder', () => {
  const plan = planNewProjectFolder({
    projectId: '00000000-0000-4000-8000-000000000201',
    projectCode: 'P26-0041',
    clientDisplayName: 'Synthetic Client',
    addressLine: '123 W 78th St Apt 4A',
  });

  it('is a pure create-only plan with deferred owner-gated execution', () => {
    expect(plan.kind).toBe('drive_folder_create_plan');
    expect(plan.execution).toBe('deferred_owner_gated');
    expect(plan.template_version).toBe(1);
    expect(plan.steps.every((s) => s.kind === 'create_folder')).toBe(true);
    const json = JSON.stringify(plan).toLowerCase();
    for (const bad of ['"move', '"delete', '"trash', '"rename', '"copy']) {
      expect(json).not.toContain(bad);
    }
  });

  it('orders client folder, project folder, then the 14 subfolders', () => {
    expect(plan.steps).toHaveLength(16);
    expect(plan.steps[0]).toMatchObject({
      name: 'Synthetic Client', parent: 'clients_root', order: 0,
    });
    expect(plan.steps[1]).toMatchObject({
      name: 'P26-0041 - 123 W 78th St Apt 4A',
      parent: 'client_folder',
      order: 1,
    });
    const subs = plan.steps.slice(2);
    expect(subs.map((s) => s.name)).toEqual([...FOLDER_TEMPLATE_V1]);
    expect(subs.every((s) => s.parent === 'project_folder')).toBe(true);
    expect(plan.steps.map((s) => s.order)).toEqual(
      plan.steps.map((_, i) => i));
  });

  it('is deterministic', () => {
    const again = planNewProjectFolder({
      projectId: '00000000-0000-4000-8000-000000000201',
      projectCode: 'P26-0041',
      clientDisplayName: 'Synthetic Client',
      addressLine: '123 W 78th St Apt 4A',
    });
    expect(again).toEqual(plan);
  });

  it('rejects an empty client name', () => {
    expect(() => planNewProjectFolder({
      projectId: 'x', projectCode: 'P26-0041',
      clientDisplayName: '***', addressLine: '1 Main St',
    })).toThrow();
  });
});

describe('subfoldersComplete', () => {
  it('requires every template name to be bound to a drive id', () => {
    const full: Record<string, string> = {};
    FOLDER_TEMPLATE_V1.forEach((n, i) => { full[n] = `folder-${i}`; });
    expect(subfoldersComplete(full)).toBe(true);
    const partial = { ...full };
    delete partial['13 Warranty'];
    expect(subfoldersComplete(partial)).toBe(false);
    expect(subfoldersComplete({ ...full, '00 Intake': '' })).toBe(false);
  });
});
