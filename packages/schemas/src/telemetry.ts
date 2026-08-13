import { z } from "zod";

export const TELEMETRY_ATTRIBUTES = Object.freeze([
  "crip.intent.id",
  "crip.operation.id",
  "crip.agent.id",
  "crip.wallet.id",
  "crip.adapter.id",
  "crip.chain.id",
  "crip.action",
  "crip.policy.id",
  "crip.policy.version",
  "crip.policy.decision",
  "crip.approval.required",
  "crip.reservation.id",
  "crip.transaction.hash",
  "crip.lifecycle.state",
  "crip.failure.class",
] as const);

export const TELEMETRY_METRICS = Object.freeze([
  "crip.intents.created",
  "crip.policy.allows",
  "crip.policy.approvals",
  "crip.policy.denials",
  "crip.policy.indeterminate",
  "crip.reservations.created",
  "crip.reservations.finalized",
  "crip.reservations.released",
  "crip.reservations.expired",
  "crip.reservations.disputed",
  "crip.approval.latency",
  "crip.signing.latency",
  "crip.confirmation.latency",
  "crip.simulation.failures",
  "crip.broadcast.retries",
  "crip.duplicate_requests",
  "crip.reconciliation.discrepancies",
  "crip.revocations",
  "crip.paused_operation_blocks",
  "crip.adapter.errors",
  "crip.rpc.disagreements",
] as const);

export const TELEMETRY_SPANS = Object.freeze([
  "crip.intent.validation",
  "crip.policy.precheck",
  "crip.transaction.construction",
  "crip.transaction.decoding",
  "crip.transaction.simulation",
  "crip.policy.final",
  "crip.budget.reservation",
  "crip.approval",
  "crip.signing",
  "crip.broadcast",
  "crip.confirmation",
  "crip.reconciliation",
] as const);

export const telemetryAttributeSchema = z.enum(TELEMETRY_ATTRIBUTES);
export const telemetryMetricSchema = z.enum(TELEMETRY_METRICS);
export const telemetrySpanSchema = z.enum(TELEMETRY_SPANS);
export const telemetryIdentifierSchema = z.union([
  telemetryAttributeSchema,
  telemetryMetricSchema,
  telemetrySpanSchema,
]);

export type TelemetryAttribute = z.infer<typeof telemetryAttributeSchema>;
export type TelemetryMetric = z.infer<typeof telemetryMetricSchema>;
export type TelemetrySpan = z.infer<typeof telemetrySpanSchema>;
