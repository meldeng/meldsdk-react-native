type Order = Record<string, unknown>;
interface Bridge {
  capabilities?: (order: Order) => Promise<unknown>;
  headlessProtocolVersion?: unknown;
}
interface Capabilities { embeddable: boolean; surface: string; requiresUserGesture: boolean }

const unsupported: Capabilities = { embeddable: false, surface: 'unsupported', requiresUserGesture: false };

/** Native binaries, not OTA JavaScript, own support for declared presentation protocols. */
export function canMountOrder(order: Order, bridge?: Bridge | null): boolean {
  return typeof bridge?.capabilities === 'function'
    && (!Object.prototype.hasOwnProperty.call(order, 'headlessPresentation') || bridge.headlessProtocolVersion === 1);
}

export async function inspectCapabilities(order: Order, bridge?: Bridge | null): Promise<Capabilities> {
  if (!canMountOrder(order, bridge)) return { ...unsupported };
  const value = await bridge!.capabilities!(order);
  if (typeof value !== 'object' || value == null) return { ...unsupported };
  const result = value as Partial<Capabilities>;
  if (typeof result.embeddable !== 'boolean' || typeof result.surface !== 'string' || !result.surface
      || typeof result.requiresUserGesture !== 'boolean') return { ...unsupported };
  return { embeddable: result.embeddable, surface: result.surface, requiresUserGesture: result.requiresUserGesture };
}
