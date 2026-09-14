// Phase 1 Lane B - standard Drive project folder template (plan 5.2).
//
// PURE DATA ONLY. Nothing here talks to Google Drive. planNewProjectFolder
// returns the ordered list of folders a future, owner-gated Drive write
// capability would create. Drive names are human convenience; Supabase ids
// stay authoritative (plan 5.2). No move/delete step can exist in a plan.

import { PROJECT_CODE_RE } from './types';
import type { DocumentType } from './types';

export const FOLDER_TEMPLATE_VERSION = 1;

export const FOLDER_TEMPLATE_V1 = [
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
] as const;
export type FolderName = (typeof FOLDER_TEMPLATE_V1)[number];

export const CLIENTS_ROOT_PATH = 'PRESTON BUSINESS FILES/Clients';

// Logical category -> physical subfolder (plan 5.9: the UI shows the
// logical category; the subfolder is where the original lands).
export const DOCUMENT_TYPE_FOLDER: Record<DocumentType, FolderName> = {
  intake: '00 Intake',
  site_photo: '01 Site Photos',
  measurement: '02 Measurements',
  plan: '03 Plans & Design',
  design: '03 Plans & Design',
  product_spec: '04 Product & Vendor',
  vendor_quote: '04 Product & Vendor',
  quote_request: '04 Product & Vendor',
  proposal: '05 Quotes & Proposals',
  contract: '06 Contract',
  payment_receipt: '07 Payments & Receipts',
  lpc_dob_building: '08 LPC DOB & Building',
  purchase_order: '09 Purchase Order',
  order_confirmation: '10 Order & Delivery',
  delivery: '10 Order & Delivery',
  installation_photo: '11 Installation',
  punch: '12 Punch & Closeout',
  closeout: '12 Punch & Closeout',
  warranty: '13 Warranty',
  knowledge: '00 Intake',
  other: '00 Intake',
};

// Drive display names: printable ASCII only, no path separators, no
// characters that are unsafe in filenames or that mimic the code/address
// separator. Whitespace is collapsed to single spaces.
const UNSAFE_NAME_CHARS = /[^A-Za-z0-9 .,'#&()-]/g;

export function sanitizeDisplaySegment(raw: string): string {
  return raw
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(UNSAFE_NAME_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function projectFolderName(
  projectCode: string,
  addressLine: string,
): string {
  if (!PROJECT_CODE_RE.test(projectCode)) {
    throw new Error(`invalid project code: ${projectCode}`);
  }
  const address = sanitizeDisplaySegment(addressLine);
  if (address.length === 0) {
    throw new Error('address line required');
  }
  return `${projectCode} - ${address}`;
}

export interface FolderCreateStep {
  readonly kind: 'create_folder';
  readonly order: number;
  readonly name: string;
  // 'clients_root' = PRESTON BUSINESS FILES/Clients; 'client_folder' =
  // the client display folder; 'project_folder' = the project root.
  readonly parent: 'clients_root' | 'client_folder' | 'project_folder';
  // stable key the executor reports back as name -> drive folder id
  readonly key: string;
}

export interface NewProjectFolderPlan {
  readonly kind: 'drive_folder_create_plan';
  readonly template_version: number;
  readonly project_id: string;
  readonly project_code: string;
  readonly client_folder_name: string;
  readonly project_folder_name: string;
  readonly steps: readonly FolderCreateStep[];
  // Execution is a separate owner-gated Drive WRITE capability; this
  // module never executes anything.
  readonly execution: 'deferred_owner_gated';
}

export interface NewProjectFolderInput {
  projectId: string;
  projectCode: string;
  clientDisplayName: string;
  addressLine: string;
}

export function planNewProjectFolder(
  input: NewProjectFolderInput,
): NewProjectFolderPlan {
  const clientFolder = sanitizeDisplaySegment(input.clientDisplayName);
  if (clientFolder.length === 0) {
    throw new Error('client display name required');
  }
  const projectFolder = projectFolderName(
    input.projectCode,
    input.addressLine,
  );
  const steps: FolderCreateStep[] = [
    {
      kind: 'create_folder',
      order: 0,
      name: clientFolder,
      parent: 'clients_root',
      key: 'client_folder',
    },
    {
      kind: 'create_folder',
      order: 1,
      name: projectFolder,
      parent: 'client_folder',
      key: 'project_folder',
    },
  ];
  FOLDER_TEMPLATE_V1.forEach((name, i) => {
    steps.push({
      kind: 'create_folder',
      order: 2 + i,
      name,
      parent: 'project_folder',
      key: name,
    });
  });
  return {
    kind: 'drive_folder_create_plan',
    template_version: FOLDER_TEMPLATE_VERSION,
    project_id: input.projectId,
    project_code: input.projectCode,
    client_folder_name: clientFolder,
    project_folder_name: projectFolder,
    steps,
    execution: 'deferred_owner_gated',
  };
}

// Shape of project_drive_folders.subfolders after an executor reports
// back: every template name must be bound to a Drive folder id.
export function subfoldersComplete(
  subfolders: Record<string, unknown>,
): boolean {
  return FOLDER_TEMPLATE_V1.every(
    (n) => typeof subfolders[n] === 'string' &&
      (subfolders[n] as string).length > 0,
  );
}
