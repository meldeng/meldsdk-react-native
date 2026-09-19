type JsonObject = Record<string, unknown>;
type Environment = 'sandbox' | 'qa' | 'production';
const PROTOCOL = 'MELD_ORDER_AUTHORIZATION_V1';
const BASES = { sandbox: 'https://api-sb.meld.io', qa: 'https://api-qa.meld.io', production: 'https://api.meld.io' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bearer = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && value.length <= 16384 && !/[^\x21-\x7e]/.test(value);
const POINTERS: Record<string, string> = {
  '/paymentMethodResponseDetails/continuationToken': 'continuationToken',
  '/paymentMethodResponseDetails/sessionToken': 'sessionToken',
};
const record = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Fixed diagnostics never retain an order, response, URL, bearer or underlying exception. */
export class MeldOrderAuthorizationError extends Error {
  readonly code = 'INVALID_ORDER_AUTHORIZATION';
  constructor() { super('Order authorization could not be applied.'); this.name = 'MeldOrderAuthorizationError'; }
}

function descriptor(order: JsonObject, environment: Environment) {
  if (!record(order) || !Object.prototype.hasOwnProperty.call(BASES, environment)) return null;
  const actions = order.paymentActions;
  if (!record(actions) || actions.version !== 1 || typeof order.id !== 'string'
      || !/^[1-9A-HJ-NP-Za-km-z]{16,22}$/.test(order.id)
      || typeof actions.endpoint !== 'string' || typeof actions.bearerTokenPointer !== 'string'
      || !Object.prototype.hasOwnProperty.call(POINTERS, actions.bearerTokenPointer)) return null;
  const base = BASES[environment];
  if (!base) return null;
  const endpoint = actions.endpoint.startsWith(base + '/') ? actions.endpoint.slice(base.length) : actions.endpoint;
  const parts = /^\/crypto\/order\/headless\/onramp\/([A-Z][A-Z0-9_]{0,63})\/([1-9A-HJ-NP-Za-km-z]{16,22})\/actions$/.exec(endpoint);
  if (!parts || parts[0] !== endpoint || parts[2] !== order.id || (order.serviceProvider != null && order.serviceProvider !== parts[1])) return null;
  if (record(order.payload) && order.payload.serviceProvider != null && order.payload.serviceProvider !== parts[1]) return null;
  const renewal = actions.authorizationRenewal;
  const path = endpoint.slice(0, -'actions'.length) + 'authorization';
  if (!record(renewal) || renewal.version !== 1 || renewal.protocol !== PROTOCOL
      || renewal.authentication !== 'INTEGRATOR_ACCOUNT' || (renewal.endpoint !== path && renewal.endpoint !== base + path)) return null;
  const details = order.paymentMethodResponseDetails;
  const field = POINTERS[actions.bearerTokenPointer];
  if (!record(details) || !Object.prototype.hasOwnProperty.call(details, field)
      || !bearer(details[field])) return null;
  return { provider: parts[1], details, field };
}

/** Advisory only. Call your authenticated backend to READ current eligibility, then explicitly renew. */
export function canRenewOrderAuthorization(order: JsonObject, environment: Environment): boolean {
  return descriptor(order, environment) !== null;
}

/**
 * Apply an AUTHORIZED response after the prior native flow has ended. This does not unmount,
 * authenticate, renew, retry payment or clear pending operation journals. Mount the returned
 * existing order separately; persist only the renewal request identity, never this credential.
 */
export function applyOrderAuthorization(order: JsonObject, response: unknown, environment: Environment): JsonObject {
  const binding = descriptor(order, environment);
  if (!binding || !record(response) || response.version !== 1 || response.protocol !== PROTOCOL
      || response.state !== 'AUTHORIZED' || response.orderId !== order.id || response.serviceProvider !== binding.provider
      || typeof response.authorizationId !== 'string' || response.authorizationId.length !== 36 || !UUID.test(response.authorizationId)
      || typeof response.expiresAt !== 'string' || !response.expiresAt.endsWith('Z')
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(response.expiresAt)
      || !bearer(response.bearer)) throw new MeldOrderAuthorizationError();
  const expiry = Date.parse(response.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()
      || new Date(expiry).toISOString().slice(0, 19) !== response.expiresAt.slice(0, 19)) throw new MeldOrderAuthorizationError();
  return { ...order, paymentMethodResponseDetails: { ...binding.details, [binding.field]: response.bearer } };
}
