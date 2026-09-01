// Preston Supervisor - plugin API client. Every request goes to THIS
// plugin's own backend routes (/api/plugins/preston-supervisor/*),
// which the Hermes dashboard mounts behind its auth gate and which
// proxy ONLY the seven supported Preston Control reads. The security
// boundary test pins that no other path is ever fetched and that no
// credential appears in frontend code.

import { sdk } from "../sdk";

export const API_BASE = "/api/plugins/preston-supervisor";

export type ApiResult<T> =
  | { kind: "unconfigured" }
  | { kind: "error"; error: string }
  | { kind: "ok"; data: T };

interface Envelope {
  linked?: boolean;
  ok?: boolean;
  error?: string;
  data?: unknown;
}

export async function readOp<T>(path: string): Promise<ApiResult<T>> {
  let res: Envelope;
  try {
    res = (await sdk().fetchJSON(API_BASE + path)) as Envelope;
  } catch {
    return { kind: "error", error: "plugin_api_unreachable" };
  }
  if (!res || typeof res !== "object") {
    return { kind: "error", error: "plugin_api_bad_response" };
  }
  if (res.linked === false) return { kind: "unconfigured" };
  if (res.ok !== true) {
    return { kind: "error", error: String(res.error ?? "unknown") };
  }
  return { kind: "ok", data: res.data as T };
}

export interface LinkState {
  configured: boolean;
  host: string;
}

export async function readLink(): Promise<LinkState> {
  try {
    const res = (await sdk().fetchJSON(API_BASE + "/link")) as LinkState;
    return {
      configured: res?.configured === true,
      host: String(res?.host ?? ""),
    };
  } catch {
    return { configured: false, host: "" };
  }
}
