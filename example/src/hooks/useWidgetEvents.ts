import { useCallback, useRef, useState } from 'react';
import {
  type MeldStatus,
  type MeldStatusChange,
  type MeldError,
} from '@meldcrypto/react-native-sdk';

export interface WidgetHandlers {
  onReady: () => void;
  onPaymentSubmitted: () => void;
  onStatusChange: (e: MeldStatusChange) => void;
  onCancel: () => void;
  onError: (e: MeldError) => void;
}

// Translates <MeldWidget> events into a visible event log + status, and auto-closes the widget
// shortly after a terminal event (demo-only) so the outcome stays on screen.
export function useWidgetEvents(onClose: () => void) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<MeldStatus | null>(null);
  const closing = useRef(false);

  const record = useCallback((line: string) => {
    console.log('[demo]', line);
    const t = new Date().toISOString().slice(11, 19);
    setLines(prev => [...prev, `${t}  ${line}`]);
  }, []);

  const finish = useCallback(
    (reason: string) => {
      if (closing.current) return;
      closing.current = true;
      record(`→ closing widget (${reason})`);
      setTimeout(onClose, 1500);
    },
    [onClose, record],
  );

  const handlers: WidgetHandlers = {
    onReady: () => record('onReady'),
    onPaymentSubmitted: () =>
      record('onPaymentSubmitted (UX hint, not settled)'),
    onStatusChange: e => {
      setStatus(e.status);
      record(`onStatusChange: ${e.status} (${e.providerStatus ?? '-'})`);
      if (e.status === 'completed') finish('completed');
      if (e.status === 'failed') finish('failed');
    },
    onCancel: () => {
      setStatus('cancelled');
      record('onCancel');
      finish('cancelled');
    },
    onError: e => {
      setStatus('failed');
      record(`onError [${e.code}] ${e.message}`);
      finish('error');
    },
  };

  return { lines, status, handlers };
}
