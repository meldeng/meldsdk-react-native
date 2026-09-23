type Order = Record<string, unknown>;
interface Bridge {
  capabilities?: (order: Order) => Promise<unknown>;
  presentationCapabilities?: (paymentMethodType: string, presentation: MeldHeadlessPresentation) => Promise<unknown>;
  headlessProtocolVersion?: unknown;
}
interface Capabilities { embeddable: boolean; surface: string; requiresUserGesture: boolean }

/** Server-declared identifiers stay open so the installed native registry owns protocol support. */
export interface MeldHeadlessPresentation { surface: string; protocol: string; version: number }

const unsupported: Capabilities = { embeddable: false, surface: 'unsupported', requiresUserGesture: false };

/** Native binaries, not OTA JavaScript, own support for declared presentation protocols. */
export function canMountOrder(order: Order, bridge?: Bridge | null): boolean {
  return typeof bridge?.capabilities === 'function'
    && (!Object.prototype.hasOwnProperty.call(order, 'headlessPresentation') || bridge.headlessProtocolVersion === 1);
}

export async function inspectCapabilities(order: Order, bridge?: Bridge | null): Promise<Capabilities> {
  if (!canMountOrder(order, bridge)) return { ...unsupported };
  const value = await bridge!.capabilities!(order);
  return parseCapabilities(value);
}

/** Advisory quote support, never an order validation or authorization to create/pay. */
export async function inspectPresentationCapabilities(
  paymentMethodType: string, presentation: MeldHeadlessPresentation, bridge?: Bridge | null,
): Promise<Capabilities> {
  if (bridge?.headlessProtocolVersion !== 1 || typeof bridge.presentationCapabilities !== 'function'
      || !identifier(paymentMethodType) || !validPresentation(presentation)) return { ...unsupported };
  return parseCapabilities(await bridge.presentationCapabilities(paymentMethodType, presentation));
}

function validPresentation(value: MeldHeadlessPresentation): boolean {
  return typeof value === 'object' && value != null && !Array.isArray(value)
    && identifier(value.surface) && identifier(value.protocol)
    && Number.isInteger(value.version) && value.version > 0 && value.version <= 2147483647;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && /^[A-Z]/.test(value) && !/[^A-Z0-9_]/.test(value);
}

function parseCapabilities(value: unknown): Capabilities {
  if (typeof value !== 'object' || value == null) return { ...unsupported };
  const result = value as Partial<Capabilities>;
  if (typeof result.embeddable !== 'boolean' || typeof result.surface !== 'string' || !result.surface
      || typeof result.requiresUserGesture !== 'boolean') return { ...unsupported };
  return { embeddable: result.embeddable, surface: result.surface, requiresUserGesture: result.requiresUserGesture };
}
