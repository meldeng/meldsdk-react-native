/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('renders correctly', async () => {
  // async act so the mount effects (the quote fetch in useQuote) flush inside act,
  // rather than firing a state update after the renderer has been torn down. RN flushes
  // passive effects on a setImmediate, so wait one macrotask for it to settle.
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<App />);
    await new Promise<void>(resolve => setImmediate(() => resolve()));
  });
});
