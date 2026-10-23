type Order = Record<string, unknown>;
interface Bridge {
  capabilities?: (order: Order) => Promise<unknown>;
  presentationCapabilities?: (paymentMethodType: string, presentation: MeldHeadlessPresentation) => Promise<unknown>;
  presentationReadiness?: (paymentMethodType: string, presentation: MeldHeadlessPresentation) => Promise<unknown>;
  paymentMethodReadiness?: (paymentMethodType: string) => Promise<unknown>;
  headlessProtocolVersion?: unknown;
}
interface Capabilities { embeddable: boolean; surface: string; requiresUserGesture: boolean }

/** Server-declared identifiers stay open so the installed native registry owns protocol support. */
export interface MeldHeadlessPresentation { surface: string; protocol: string; version: number }

/** The two fields of a quote row (or payment method) that name how it is presented. */
export interface MeldPresentationRow { paymentMethodType: string; headlessPresentation: MeldHeadlessPresentation }

/**
 * Whether this device can pay with a quote row's method. `code` comes only with `unavailable` and
 * uses the same terms a mounted order would; `reason` is for logging.
 */
export interface MeldReadiness {
  status: 'ready' | 'unavailable' | 'unknown';
  code?: string;
  reason?: string;
}

const unsupported: Capabilities = { embeddable: false, surface: 'unsupported', requiresUserGesture: false };

/**
 * Declarations that bridges without the protocol registry (MeldSDK iOS 0.7, Android 0.6) already
 * present: their legacy dispatch routes these orders to the adapter that implements the protocol.
 */
const legacyDispatch = new Set([
  'CREDIT_DEBIT_CARD/EMBEDDED_WIDGET/MERCURYO_WIDGET/1',
  'CREDIT_DEBIT_CARD/EMBEDDED_WIDGET/UPHOLD_WIDGET/1',
  'CREDIT_DEBIT_CARD/VENDOR_SDK/BANXA_CHECKOUT/1',
  'APPLE_PAY/VENDOR_SDK/BANXA_CHECKOUT/1',
  'APPLE_PAY/PROVIDER_HOSTED/COINBASE_APPLE_PAY/1',
  'APPLE_PAY/NATIVE_TOKEN/MELD_WALLET_TOKEN/1',
]);

/** Module presence only; protocol and wallet support come from the capability checks. */
export function isNativeBridgeAvailable(platform: string, bridge?: Bridge | null): boolean {
  return (platform === 'ios' || platform === 'android') && typeof bridge?.capabilities === 'function';
}

/** Native binaries, not OTA JavaScript, own support for declared presentation protocols. */
export function canMountOrder(order: Order, bridge?: Bridge | null): boolean {
  if (typeof bridge?.capabilities !== 'function') return false;
  if (!Object.prototype.hasOwnProperty.call(order, 'headlessPresentation') || bridge.headlessProtocolVersion === 1) {
    return true;
  }
  const presentation = order.headlessPresentation;
  return identifier(order.paymentMethodType) && validPresentation(presentation) && legacyDispatch.has(
    `${order.paymentMethodType}/${presentation.surface}/${presentation.protocol}/${presentation.version}`);
}

export async function inspectCapabilities(order: Order, bridge?: Bridge | null): Promise<Capabilities> {
  if (!canMountOrder(order, bridge)) return { ...unsupported };
  const value = await bridge!.capabilities!(order);
  return parseCapabilities(value);
}

/** The method and descriptor named by a quote row, or by the positional form. */
export function presentationOf(rowOrType: unknown, presentation?: unknown): [unknown, unknown] {
  if (typeof rowOrType !== 'object' || rowOrType == null) return [rowOrType, presentation];
  const row = rowOrType as Record<string, unknown>;
  return [row.paymentMethodType, row.headlessPresentation];
}

/** Advisory quote support, never an order validation or authorization to create/pay. */
export async function inspectPresentationCapabilities(
  paymentMethodType: unknown, presentation: unknown, bridge?: Bridge | null,
): Promise<Capabilities> {
  if (bridge?.headlessProtocolVersion !== 1 || typeof bridge.presentationCapabilities !== 'function'
      || !identifier(paymentMethodType) || !validPresentation(presentation)) return { ...unsupported };
  return parseCapabilities(await bridge.presentationCapabilities(paymentMethodType, presentation));
}

/** The one platform that presents each wallet, and the wallet's name. */
const wallets = new Map([
  ['APPLE_PAY', { platform: 'ios', name: 'Apple Pay' }],
  ['GOOGLE_PAY', { platform: 'android', name: 'Google Pay' }],
]);
const platformNames = new Map([['ios', 'iOS'], ['android', 'Android'], ['web', 'the web']]);

/** The reason every Meld SDK gives for a method nothing on the device decides. */
const noDeviceCheck = 'This payment method has no device check; offer it and let the payment decide.';

/**
 * Device readiness for a payment method before any quote, answered by the native SDK. A binary from
 * before the native check answers `unavailable` for a wallet this platform never presents.
 */
export async function inspectPaymentMethodReadiness(
  paymentMethodType: unknown, platform: string, bridge?: Bridge | null,
): Promise<MeldReadiness> {
  if (!identifier(paymentMethodType)) return { status: 'unknown', reason: 'The paymentMethodType is malformed.' };
  if (typeof bridge?.paymentMethodReadiness === 'function') {
    try {
      return parseReadiness(await bridge.paymentMethodReadiness(paymentMethodType));
    } catch {
      return { status: 'unknown', reason: 'The readiness check failed.' };
    }
  }
  const wallet = wallets.get(paymentMethodType);
  if (wallet !== undefined && wallet.platform !== platform) {
    return unavailable(`${wallet.name} is not available on ${platformNames.get(platform) ?? platform}.`);
  }
  return { status: 'unknown', reason: noDeviceCheck };
}

/**
 * Device readiness for a quote row, answered by the native SDK. A binary from before the native
 * check answers from presentation support.
 */
export async function inspectPresentationReadiness(row: unknown, bridge?: Bridge | null): Promise<MeldReadiness> {
  const [paymentMethodType, presentation] = presentationOf(row);
  if (!identifier(paymentMethodType) || !validPresentation(presentation)) {
    return unavailable('The row has no well-formed paymentMethodType and headlessPresentation.');
  }
  const asked = `${paymentMethodType} via ${presentation.surface}/${presentation.protocol} v${presentation.version}`;
  if (bridge?.headlessProtocolVersion !== 1) return unavailable(`This app build does not present ${asked}.`);
  try {
    if (typeof bridge.presentationReadiness === 'function') {
      return parseReadiness(await bridge.presentationReadiness(paymentMethodType, presentation));
    }
    const caps = await inspectPresentationCapabilities(paymentMethodType, presentation, bridge);
    if (caps.surface === 'unsupported') return unavailable(`This app build does not present ${asked}.`);
    return { status: 'unknown', reason: noDeviceCheck };
  } catch {
    return { status: 'unknown', reason: 'The readiness check failed.' };
  }
}

function validPresentation(value: unknown): value is MeldHeadlessPresentation {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) return false;
  const { surface, protocol, version } = value as Record<string, unknown>;
  return identifier(surface) && identifier(protocol)
    && typeof version === 'number' && Number.isInteger(version) && version > 0 && version <= 2147483647;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && /^[A-Z]/.test(value) && !/[^A-Z0-9_]/.test(value);
}

function unavailable(reason: string): MeldReadiness {
  return { status: 'unavailable', code: 'PAYMENT_METHOD_UNAVAILABLE', reason };
}

function parseReadiness(value: unknown): MeldReadiness {
  const result = (typeof value === 'object' && value != null ? value : {}) as Record<string, unknown>;
  const reason = typeof result.reason === 'string' && result.reason ? { reason: result.reason } : {};
  switch (result.status) {
    case 'ready': return { status: 'ready' };
    case 'unavailable':
      return { status: 'unavailable', code: identifier(result.code) ? result.code : 'PAYMENT_METHOD_UNAVAILABLE', ...reason };
    case 'unknown': return { status: 'unknown', ...reason };
    default: return { status: 'unknown', reason: 'The native readiness answer was malformed.' };
  }
}

function parseCapabilities(value: unknown): Capabilities {
  if (typeof value !== 'object' || value == null) return { ...unsupported };
  const result = value as Partial<Capabilities>;
  if (typeof result.embeddable !== 'boolean' || typeof result.surface !== 'string' || !result.surface
      || typeof result.requiresUserGesture !== 'boolean') return { ...unsupported };
  return { embeddable: result.embeddable, surface: result.surface, requiresUserGesture: result.requiresUserGesture };
}
