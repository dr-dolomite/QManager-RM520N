import type { TFunction } from "i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";

// One wizard write. CGI failures answer 200 with {"success":false,...}, so `.success`
// is the only honest signal; `resp.ok` cannot see a modem error. Never throws.

export interface StepWriteResult {
  ok: boolean;
  /** Backend error code, for resolveErrorMessage. */
  error?: string;
  /** Backend detail (English fallback text). */
  detail?: string;
  /** True when the request never reached the modem. */
  unreachable?: boolean;
}

interface Envelope {
  success?: boolean;
  error?: string;
  detail?: string;
}

export async function postStep(endpoint: string, body: unknown): Promise<StepWriteResult> {
  let response: Response;
  try {
    response = await authFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, unreachable: true };
  }

  let data: Envelope | null = null;
  try {
    data = (await response.json()) as Envelope;
  } catch {
    data = null;
  }

  // A partial apply (success:false with failed_fields) counts as a failure.
  if (response.ok && data?.success === true) return { ok: true };
  return {
    ok: false,
    error: data?.error || undefined,
    detail: data?.detail || undefined,
  };
}

/** The reason for a failed write; `t` is the onboarding-namespace translator. */
export function stepFailureMessage(t: TFunction, result: StepWriteResult, fallback: string): string {
  if (result.unreachable) return t("shell.error_unreachable");
  return resolveErrorMessage(t, result.error, result.detail, fallback);
}
