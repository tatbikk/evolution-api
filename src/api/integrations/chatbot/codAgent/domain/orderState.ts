/**
 * COD order lifecycle state machine.
 *
 * This is the single authoritative definition of which order status
 * transitions are allowed. All status changes must go through
 * `assertTransition` so an invalid transition can never be persisted —
 * the database CHECK constraint only guards the set of valid values, not
 * the transitions between them.
 */

export type CodOrderStatus =
  | 'pending'
  | 'awaiting_customer'
  | 'confirmed'
  | 'rescheduled'
  | 'cancelled'
  | 'needs_human'
  | 'no_response';

export const COD_ORDER_STATUSES: CodOrderStatus[] = [
  'pending',
  'awaiting_customer',
  'confirmed',
  'rescheduled',
  'cancelled',
  'needs_human',
  'no_response',
];

/**
 * Allowed transitions. `cancelled` is the only fully terminal state.
 * `confirmed` / `rescheduled` remain adjustable because a customer can
 * still change their mind after an initial decision.
 */
const TRANSITIONS: Record<CodOrderStatus, CodOrderStatus[]> = {
  pending: ['awaiting_customer', 'cancelled'],
  awaiting_customer: ['confirmed', 'rescheduled', 'cancelled', 'needs_human', 'no_response'],
  rescheduled: ['awaiting_customer', 'confirmed', 'cancelled', 'needs_human'],
  needs_human: ['awaiting_customer', 'confirmed', 'rescheduled', 'cancelled'],
  // A customer who replies after the no-response timeout can still decide:
  // a late reply is a valid reply.
  no_response: ['awaiting_customer', 'confirmed', 'rescheduled', 'cancelled', 'needs_human'],
  confirmed: ['rescheduled', 'cancelled'],
  cancelled: [],
};

export function isValidStatus(value: any): value is CodOrderStatus {
  return typeof value === 'string' && (COD_ORDER_STATUSES as string[]).includes(value);
}

export function isTerminalStatus(status: CodOrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function canTransition(from: CodOrderStatus, to: CodOrderStatus): boolean {
  if (!isValidStatus(from) || !isValidStatus(to)) return false;
  return TRANSITIONS[from].includes(to);
}

/**
 * Throws when a transition is not allowed. Callers should let this
 * propagate so an illegal status change is rejected, not silently applied.
 */
export function assertTransition(from: CodOrderStatus, to: CodOrderStatus): void {
  if (!isValidStatus(from)) {
    throw new Error(`Invalid current order status: "${from}"`);
  }
  if (!isValidStatus(to)) {
    throw new Error(`Invalid target order status: "${to}"`);
  }
  if (!canTransition(from, to)) {
    throw new Error(`Illegal COD order transition: "${from}" -> "${to}"`);
  }
}
