type Json = Record<string, unknown>;

export type MeldReadyStatus =
  'READY' | 'UNDETERMINED' | 'PENDING' | 'BLOCKED' | 'ACTION_REQUIRED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';
export type MeldReadyState = 'READING' | 'RUNNING' | 'AWAITING_INPUT' | 'PRESENTING' | 'WAITING';

export interface MeldReadyField { key: string; label?: string; fieldType?: string; jsonSchema?: string; allowedValues?: string[] }

/** A step the session offers. `kind` is `SUBMIT`, `COLLECT`, `AGREE`, `OPEN_URL`, `VERIFY_CONTACT` or a newer one. */
export interface MeldReadyStep {
  stepId: string;
  kind: string;
  type: string;
  code: string;
  serviceProviders: string[];
  level?: string;
  /** The terms document for `AGREE`, the page for `OPEN_URL`. A capability link: never log it. */
  url?: string;
  expiresAt?: string;
  fields?: MeldReadyField[];
  reason?: string;
}

export interface MeldReadyProvider {
  serviceProvider: string;
  status: string;
  eligible: boolean | null;
  /**
   * The provider's pre-order requirements that are not satisfied. A share the provider refused carries its
   * `errorCodes`, such as `PHONE_VERIFICATION_REQUIRED`: an open set, absent when Meld sends none.
   */
  open: { type: string; code: string; status: string; reason?: string; errorCodes?: string[] }[];
}

/** A step that runs inside the mounted order, once it exists. */
export interface MeldReadyContinuation { serviceProvider: string; code: string; nextStep?: string }

export interface MeldReadyError { kind: 'http' | 'transport' | 'protocol'; status?: number; code?: string }

export interface MeldReadyResult {
  status: MeldReadyStatus;
  providers: MeldReadyProvider[];
  /** What is left for the customer or your backend. `ACTION_REQUIRED` only. */
  pending?: MeldReadyStep[];
  continuation: MeldReadyContinuation[];
  /** `FAILED` only. */
  error?: MeldReadyError;
}

export interface MeldFieldError { key: string; reason: string }
export interface MeldCollectRequest {
  stepId: string;
  type: string;
  code: string;
  serviceProviders: string[];
  fields: MeldReadyField[];
  reason?: string;
  /** Why Meld refused the previous answer. Never the values. */
  fieldErrors?: MeldFieldError[];
}
export interface MeldAgreementRequest { stepId: string; serviceProvider: string; code: string; url?: string }
export interface MeldPresentUrlRequest { stepId: string; url: string; expiresAt?: string }
export interface MeldReadyProgress { state: MeldReadyState; snapshot: unknown }

/**
 * What only your app can supply. A handler you leave out makes the steps that need it end the run
 * `ACTION_REQUIRED`. Answer `collect`, `confirmAgreement` and `renewSession` within 10 minutes, or
 * the run ends `CANCELLED`; `presentUrl` has no limit. No handler is called once `result` has resolved.
 */
export interface MeldReadyHandlers {
  onProgress?(e: MeldReadyProgress): void;
  /** The values by field key, or `null` when your backend handled the step. */
  collect?(r: MeldCollectRequest): Promise<Record<string, string> | null> | Record<string, string> | null;
  /** True once the customer accepted. The SDK never accepts on its own. */
  confirmAgreement?(a: MeldAgreementRequest): Promise<boolean> | boolean;
  /** Present the page yourself, instead of the native browser, and resolve once it is closed, however long that takes. */
  presentUrl?(p: MeldPresentUrlRequest): Promise<void> | void;
  /**
   * A newly minted session when Meld refused this one (401), or `null` to end the run `EXPIRED`. Asked
   * at most once between two successful answers and at most 3 times per run; the next refusal ends
   * the run `EXPIRED`.
   */
  renewSession?(): Promise<object | null> | object | null;
}

export interface MeldReadyOptions {
  /** How long to keep polling while only reviews are left, before `PENDING`. Default 600000. */
  waitTimeoutMs?: number;
}

/** Once `result` has resolved, the handle holds none of your handlers, so it can be kept. */
export interface MeldReadyHandle {
  result: Promise<MeldReadyResult>;
  /** End a wait and read now, as when your backend relays `CUSTOMER_KYC_STATUS_CHANGE`. A retry keeps its backoff. */
  refresh(): void;
  /** Stop the run. Its result is `CANCELLED`, and an answer still pending is dropped. */
  cancel(): void;
}

export interface ReadyBridge {
  ensureReady?: (handleId: string, sessionJson: string, optionsJson: string) => void;
  respond?: (handleId: string, requestId: string, json: string) => void;
  refresh?: (handleId: string) => void;
  cancel?: (handleId: string) => void;
  openHostedVerification?: (url: string) => Promise<unknown>;
}
export type ReadyEvents = (listener: (event: unknown) => void) => { remove(): void };

export const READY_EVENT = 'MeldReadyEvent';
export const REQUEST_TIMEOUT_MS = 600_000;

const handlerNames = ['onProgress', 'collect', 'confirmAgreement', 'presentUrl', 'renewSession'] as const;
const statuses = new Set(['READY', 'UNDETERMINED', 'PENDING', 'BLOCKED', 'ACTION_REQUIRED', 'CANCELLED', 'EXPIRED', 'FAILED']);
const errorKinds = new Set(['http', 'transport', 'protocol']);
let runs = 0;

/** Runs a requirements session on the native SDK, answering its requests from `handlers`. */
export function runEnsureReady(
  bridge: ReadyBridge | null | undefined, events: ReadyEvents | undefined,
  session: unknown, handlers?: MeldReadyHandlers, options?: MeldReadyOptions,
): MeldReadyHandle {
  const sessionJson = typeof session === 'object' && session != null && !Array.isArray(session) ? json(session) : undefined;
  if (sessionJson === undefined) {
    throw new TypeError('ensureReady() requires the session from POST /crypto/onramp/requirements-sessions, passed through unchanged.');
  }
  let run: MeldReadyHandlers = handlers ?? {};
  const given = run as Record<string, unknown>;
  if (typeof given !== 'object') throw new TypeError('ensureReady() handlers must be an object.');
  const supplied: string[] = [];
  for (const name of handlerNames) {
    if (given[name] != null && typeof given[name] !== 'function') {
      throw new TypeError(`ensureReady() handler ${name} must be a function.`);
    }
    if (given[name] != null) supplied.push(name);
  }
  const waitTimeoutMs = options?.waitTimeoutMs;
  if (waitTimeoutMs !== undefined && (!Number.isFinite(waitTimeoutMs) || waitTimeoutMs < 0)) {
    throw new TypeError('ensureReady() waitTimeoutMs must be a number of milliseconds.');
  }
  const handleId = `ready-${Date.now().toString(36)}-${++runs}-${Math.random().toString(36).slice(2, 10)}`;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let settled = false;
  let subscription: { remove(): void } | undefined;
  let deliver!: (result: MeldReadyResult) => void;
  const result = new Promise<MeldReadyResult>((resolve) => { deliver = resolve; });

  function finish(value: MeldReadyResult) {
    if (settled) return;
    settled = true;
    run = {};
    timers.forEach(clearTimeout);
    timers.clear();
    subscription?.remove();
    deliver(value);
  }

  function cancel() {
    if (settled) return;
    finish({ status: 'CANCELLED', providers: [], continuation: [] });
    try { bridge?.cancel?.(handleId); } catch { /* the run already ended */ }
  }

  async function answer(type: string, requestId: string, payload: Json) {
    // A hosted page can stay open longer than the answer limit; cancel() still ends the run.
    const timer = type === 'presentUrl' ? undefined : setTimeout(() => { timers.delete(timer!); cancel(); }, REQUEST_TIMEOUT_MS);
    if (timer !== undefined) timers.add(timer);
    const reply = await ask(run, type, payload);
    if (settled || (timer !== undefined && !timers.delete(timer))) return;
    clearTimeout(timer);
    try { bridge!.respond!(handleId, requestId, JSON.stringify(reply)); } catch { /* the run already ended */ }
  }

  function receive(event: unknown) {
    if (settled || !isObject(event) || event.handleId !== handleId) return;
    const payload = isObject(event.payload) ? event.payload : {};
    switch (event.type) {
      case 'result':
        finish(readyResult(payload));
        return;
      case 'progress':
        if (typeof run.onProgress !== 'function') return;
        try {
          run.onProgress({ state: text(payload.state) as MeldReadyState, snapshot: payload.snapshot ?? null });
        } catch (e) {
          console.error('[meld-sdk] handler onProgress threw', e);
        }
        return;
      case 'collect': case 'confirmAgreement': case 'presentUrl': case 'renewSession':
        if (typeof event.requestId === 'string' && event.requestId) void answer(event.type, event.requestId, payload);
    }
  }

  const handle: MeldReadyHandle = Object.freeze({
    result,
    refresh: () => { if (!settled) bridge?.refresh?.(handleId); },
    cancel,
  });
  if (typeof bridge?.ensureReady !== 'function' || typeof bridge.respond !== 'function' || events === undefined) {
    finish(failed());
    return handle;
  }
  subscription = events(receive);
  try {
    bridge.ensureReady(handleId, sessionJson,
      JSON.stringify(waitTimeoutMs === undefined ? { handlers: supplied } : { waitTimeoutMs, handlers: supplied }));
  } catch {
    finish(failed());
  }
  return handle;
}

/** Opens a hosted verification page with the native presenter; resolves once the customer closed it. */
export async function openHostedVerificationOn(bridge: ReadyBridge | null | undefined, url: unknown): Promise<void> {
  if (typeof url !== 'string' || !/^https:\/\/[^/?#@]+([/?#]|$)/.test(url)) {
    throw new TypeError('openHostedVerification() opens https pages only.');
  }
  if (typeof bridge?.openHostedVerification !== 'function') {
    throw new Error('This app build cannot open hosted verification pages. Update the native app.');
  }
  await bridge.openHostedVerification(url);
}

/** The reply for one native request. A handler that throws or answers malformed values declines. */
async function ask(handlers: MeldReadyHandlers, type: string, payload: Json): Promise<Json> {
  try {
    switch (type) {
      case 'collect': {
        const values = handlers.collect ? await handlers.collect(collectRequest(payload)) : null;
        if (values === null || isStrings(values)) return { values: values === null ? null : { ...values } };
        console.error('[meld-sdk] collect must answer string values or null');
        return { values: null };
      }
      case 'confirmAgreement':
        return { accepted: handlers.confirmAgreement ? (await handlers.confirmAgreement(agreementRequest(payload))) === true : false };
      case 'presentUrl':
        if (handlers.presentUrl) await handlers.presentUrl(presentUrlRequest(payload));
        return {};
      default: {
        const next = handlers.renewSession ? await handlers.renewSession() : null;
        return { session: isObject(next) ? next : null };
      }
    }
  } catch (e) {
    console.error(`[meld-sdk] handler ${type} threw`, e);
    return ({ collect: { values: null }, confirmAgreement: { accepted: false }, presentUrl: {} } as Record<string, Json>)[type]
      ?? { session: null };
  }
}

/** The native result as the integrator sees it; a malformed one is a protocol failure. */
export function readyResult(value: Json): MeldReadyResult {
  const status = value.status;
  if (typeof status !== 'string' || !statuses.has(status)) return failed();
  const result: MeldReadyResult = {
    status: status as MeldReadyStatus,
    providers: list(value.providers, provider),
    continuation: list(value.continuation, (entry) => {
      const serviceProvider = text(entry.serviceProvider), code = text(entry.code);
      return serviceProvider && code ? { serviceProvider, code, ...optional(entry, 'nextStep') } : undefined;
    }),
  };
  if (status === 'ACTION_REQUIRED') result.pending = list(value.pending, step);
  if (status === 'FAILED') result.error = readyError(value.error);
  return result;
}

function failed(): MeldReadyResult {
  return { status: 'FAILED', providers: [], continuation: [], error: { kind: 'protocol' } };
}

function readyError(value: unknown): MeldReadyError {
  const error = isObject(value) ? value : {};
  const kind = typeof error.kind === 'string' && errorKinds.has(error.kind) ? error.kind as MeldReadyError['kind'] : 'protocol';
  return {
    kind,
    ...(Number.isInteger(error.status) ? { status: error.status as number } : {}),
    ...optional(error, 'code'),
  };
}

function provider(value: Json): MeldReadyProvider | undefined {
  const serviceProvider = text(value.serviceProvider), status = text(value.status);
  if (!serviceProvider || !status) return undefined;
  return {
    serviceProvider, status,
    eligible: typeof value.eligible === 'boolean' ? value.eligible : null,
    open: list(value.open, (entry) => {
      const type = text(entry.type), code = text(entry.code), state = text(entry.status);
      return type && code && state ? { type, code, status: state, ...optional(entry, 'reason'), ...errorCodes(entry) } : undefined;
    }),
  };
}

function step(value: Json): MeldReadyStep | undefined {
  const stepId = text(value.stepId), kind = text(value.kind), type = text(value.type), code = text(value.code);
  if (!stepId || !kind || !type || !code) return undefined;
  return {
    stepId, kind, type, code, serviceProviders: strings(value.serviceProviders),
    ...optional(value, 'level'), ...optional(value, 'url'), ...optional(value, 'expiresAt'),
    ...(Array.isArray(value.fields) ? { fields: list(value.fields, field) } : {}),
    ...optional(value, 'reason'),
  };
}

function field(value: Json): MeldReadyField | undefined {
  const key = text(value.key);
  if (!key) return undefined;
  return {
    key, ...optional(value, 'label'), ...optional(value, 'fieldType'), ...optional(value, 'jsonSchema'),
    ...(Array.isArray(value.allowedValues) ? { allowedValues: strings(value.allowedValues) } : {}),
  };
}

function collectRequest(value: Json): MeldCollectRequest {
  return {
    stepId: text(value.stepId), type: text(value.type), code: text(value.code),
    serviceProviders: strings(value.serviceProviders), fields: list(value.fields, field), ...optional(value, 'reason'),
    ...(Array.isArray(value.fieldErrors) ? {
      fieldErrors: list(value.fieldErrors, (entry) => {
        const key = text(entry.key), reason = text(entry.reason);
        return key && reason ? { key, reason } : undefined;
      }),
    } : {}),
  };
}

function agreementRequest(value: Json): MeldAgreementRequest {
  return { stepId: text(value.stepId), serviceProvider: text(value.serviceProvider), code: text(value.code), ...optional(value, 'url') };
}

function presentUrlRequest(value: Json): MeldPresentUrlRequest {
  return { stepId: text(value.stepId), url: text(value.url), ...optional(value, 'expiresAt') };
}

function list<T>(value: unknown, map: (entry: Json) => T | undefined): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const mapped = isObject(entry) ? map(entry) : undefined;
    return mapped === undefined ? [] : [mapped];
  });
}

function optional<K extends string>(value: Json, key: K): Partial<Record<K, string>> {
  return typeof value[key] === 'string' ? { [key]: value[key] } as Record<K, string> : {};
}

/** Only a non-empty list of strings; anything else leaves the requirement without codes. */
function errorCodes(value: Json): { errorCodes?: string[] } {
  const codes = value.errorCodes;
  return Array.isArray(codes) && codes.length > 0 && codes.every((code) => typeof code === 'string') ? { errorCodes: [...codes] } : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function isStrings(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function json(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
