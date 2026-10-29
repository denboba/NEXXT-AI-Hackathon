// Consent state machine and consent-gated handoff. The only adapter is a
// local download: nothing is transmitted to Raiffeisen or any external
// system, and no appointment is ever booked.
import type { AdviserBriefing } from "./briefing.ts";

export type ConsentScope = "briefing-content" | "contact-name";
export type ConsentStatus = "not-requested" | "requested" | "granted" | "declined";
export type ConsentState = {
  status: ConsentStatus;
  scope: ConsentScope[];
  updatedAt?: string;
  history: { status: ConsentStatus; at: string }[];
};

export const initialConsent = (): ConsentState => ({ status: "not-requested", scope: [], history: [] });

const ALLOWED: Record<ConsentStatus, ConsentStatus[]> = {
  "not-requested": ["requested"],
  requested: ["granted", "declined"],
  granted: ["declined", "requested"],
  declined: ["requested"],
};

function transition(state: ConsentState, to: ConsentStatus, now: Date, scope: ConsentScope[]): ConsentState {
  if (!ALLOWED[state.status].includes(to)) throw new Error(`Invalid consent transition ${state.status} -> ${to}`);
  const at = now.toISOString();
  return { status: to, scope, updatedAt: at, history: [...state.history, { status: to, at }] };
}

export const requestConsent = (state: ConsentState, now: Date) => transition(state, "requested", now, []);
export function grantConsent(state: ConsentState, scope: ConsentScope[], now: Date) {
  if (!scope.includes("briefing-content")) throw new Error("Consent must at least cover the briefing content");
  return transition(state, "granted", now, [...new Set(scope)]);
}
/** Declining (or withdrawing a previous grant) clears the scope. */
export const declineConsent = (state: ConsentState, now: Date) => transition(state, "declined", now, []);

export type HandoffFile = { filename: string; mimeType: string; content: string };
export interface HandoffAdapter {
  id: string;
  label: string;
  produce(briefing: AdviserBriefing): HandoffFile;
}

export const LOCAL_ADAPTER_LABEL = "Local preview - no data is sent to Raiffeisen or any external system";

export const localDownloadAdapter: HandoffAdapter = {
  id: "local-download",
  label: LOCAL_ADAPTER_LABEL,
  produce: (briefing) => ({
    filename: "adviser-briefing.json",
    mimeType: "application/json",
    content: JSON.stringify(
      {
        notice: `${LOCAL_ADAPTER_LABEL}. No appointment has been booked.`,
        briefing,
      },
      null,
      2,
    ),
  }),
};

const canInclude = (consent: ConsentState, scope: ConsentScope) => consent.status === "granted" && consent.scope.includes(scope);

/** Applies the consent scope to a briefing (adds the name only with 'contact-name'). */
function scoped(briefing: AdviserBriefing, consent: ConsentState, contactName?: string): AdviserBriefing {
  const { contactName: _drop, ...rest } = briefing;
  void _drop;
  return contactName && canInclude(consent, "contact-name") ? { ...rest, contactName } : rest;
}

export type HandoffPreview = {
  preview: AdviserBriefing;
  consentStatus: ConsentStatus;
  canExport: boolean;
  adapterLabel: string;
};

/** A preview is always available locally; it is never transmitted. */
export function prepareHandoff(briefing: AdviserBriefing, consent: ConsentState, opts: { contactName?: string; workflowStatus?: string } = {}): HandoffPreview {
  return {
    preview: scoped(briefing, consent, opts.contactName),
    consentStatus: consent.status,
    canExport: canInclude(consent, "briefing-content") && !isBlocked(opts.workflowStatus ?? briefing.validationStatus),
    adapterLabel: LOCAL_ADAPTER_LABEL,
  };
}

const isBlocked = (status: string) => status === "withheld" || status === "failed";

export type ExportResult =
  | { ok: true; file: HandoffFile; adapterId: string; adapterLabel: string; booked: false }
  | { ok: false; reason: "consent-required" | "validation-blocked" };

export function exportHandoff(args: {
  briefing: AdviserBriefing;
  consent: ConsentState;
  workflowStatus?: string;
  contactName?: string;
  adapter?: HandoffAdapter;
}): ExportResult {
  if (!canInclude(args.consent, "briefing-content")) return { ok: false, reason: "consent-required" };
  if (isBlocked(args.workflowStatus ?? args.briefing.validationStatus)) return { ok: false, reason: "validation-blocked" };
  const adapter = args.adapter ?? localDownloadAdapter;
  return {
    ok: true,
    file: adapter.produce(scoped(args.briefing, args.consent, args.contactName)),
    adapterId: adapter.id,
    adapterLabel: adapter.label,
    booked: false,
  };
}

/** Alias: "transmitting" in this demo only ever produces a local file. */
export const transmit = exportHandoff;
