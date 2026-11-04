import { Alert, Platform } from 'react-native';
import {
  Meld,
  type MeldAgreementRequest,
  type MeldCollectRequest,
  type MeldReadyResult,
} from '@meldcrypto/react-native-sdk';

// `Meld.ensureReady` with the simplest possible handlers: an alert for terms and, on iOS, one
// prompt per field a step needs. A real app shows its own screens; the SDK only asks for values
// and never renders a form. Android has no text prompt, so its fields come back in `pending`.
export function ensureReady(session: object): Promise<MeldReadyResult> {
  return Meld.ensureReady(session, {
    onProgress: e => console.log(`[demo] requirements ${e.state}`),
    collect: Platform.OS === 'ios' ? ask : undefined,
    confirmAgreement: confirm,
  }).result;
}

// `pending` is empty when no step is left that the SDK can run and none to wait for; each
// provider's `open` steps then say what is left.
export function describe(result: MeldReadyResult): string {
  const steps = result.pending?.length
    ? result.pending
    : result.status === 'ACTION_REQUIRED'
    ? result.providers.flatMap(provider => provider.open)
    : [];
  const pending = steps.map(step => `${step.type} ${step.code}`).join(', ');
  const error = result.error
    ? ` (${[result.error.kind, result.error.status, result.error.code]
        .filter(part => part !== undefined)
        .join(' ')})`
    : '';
  const left = pending ? ` — ${pending}` : '';
  return `Requirements: ${result.status}${left}${error}`;
}

function confirm(agreement: MeldAgreementRequest): Promise<boolean> {
  const terms = agreement.url ?? agreement.code;
  return new Promise(resolve =>
    Alert.alert(
      'Terms',
      `Accept ${agreement.serviceProvider}'s terms?\n${terms}`,
      [
        { text: 'Decline', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Accept', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}

async function ask(
  request: MeldCollectRequest,
): Promise<Record<string, string> | null> {
  const values: Record<string, string> = {};
  for (const field of request.fields) {
    const refused = request.fieldErrors?.find(e => e.key === field.key);
    const label = field.label ?? field.key;
    const value = await prompt(
      request.code,
      refused ? `${label}: ${refused.reason}` : label,
    );
    if (value === null) return null;
    values[field.key] = value;
  }
  return values;
}

function prompt(title: string, message: string): Promise<string | null> {
  return new Promise(resolve =>
    Alert.prompt(title, message, [
      { text: 'Skip', style: 'cancel', onPress: () => resolve(null) },
      { text: 'Submit', onPress: (value?: string) => resolve(value ?? '') },
    ]),
  );
}
