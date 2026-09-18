const recoveryByCategory = {
  INVALID_REQUEST: ['CORRECT_REQUEST'],
  AUTHENTICATION_REQUIRED: ['AUTHENTICATE'],
  ACCESS_DENIED: ['STOP'],
  NOT_FOUND: ['STOP'],
  UNSUPPORTED_PROTOCOL: ['READ_REQUIREMENTS'],
  REQUIREMENT_REQUIRED: ['READ_REQUIREMENTS'],
  REQUIREMENT_PENDING: ['READ_STATE'],
  REQUIREMENT_BLOCKED: ['STOP'],
  ORDER_REJECTED: ['STOP'],
  REQUEST_CONFLICT: ['READ_STATE'],
  OPERATION_IN_FLIGHT: ['READ_STATE'],
  STATE_CHANGED: ['READ_STATE'],
  DEPENDENCY_UNAVAILABLE: ['READ_STATE', 'RETRY_READ'],
  OUTCOME_UNKNOWN: ['READ_STATE'],
} as const;

export type MeldHeadlessErrorCategory = keyof typeof recoveryByCategory;
export type MeldHeadlessErrorRecovery = (typeof recoveryByCategory)[MeldHeadlessErrorCategory][number];

/** Recovery advice for the existing order. Never authorizes an automatic mutation or a new charge. */
export interface MeldHeadlessError {
  version: 1;
  category: MeldHeadlessErrorCategory;
  recovery: MeldHeadlessErrorRecovery;
  automaticRetryAllowed: false;
}

/** The native transport validates operation semantics, including RETRY_READ, before emitting this. */
export function parseHeadlessError(value: unknown): MeldHeadlessError | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || raw.automaticRetryAllowed !== false ||
      typeof raw.category !== 'string' || typeof raw.recovery !== 'string' ||
      !Object.prototype.hasOwnProperty.call(recoveryByCategory, raw.category)) return undefined;
  const category = raw.category as MeldHeadlessErrorCategory;
  if (!(recoveryByCategory[category] as readonly string[]).includes(raw.recovery)) return undefined;
  return {version: 1, category, recovery: raw.recovery as MeldHeadlessErrorRecovery, automaticRetryAllowed: false};
}
