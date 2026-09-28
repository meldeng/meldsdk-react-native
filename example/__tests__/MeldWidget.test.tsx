import React from 'react';
import {NativeModules} from 'react-native';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {MeldWidget} from '@meldcrypto/react-native-sdk';

jest.mock('react-native/Libraries/ReactNative/requireNativeComponent', () => ({
  __esModule: true,
  default: () => 'MockMeldWidget',
}));

const order = {
  id: 'synthetic-order',
  headlessPresentation: {surface: 'NATIVE_SDK', protocol: 'SYNTHETIC', version: 1},
  paymentActions: {version: 1},
};

afterEach(() => {
  delete NativeModules.MeldModule.headlessProtocolVersion;
});

test('an older native binary gets one error and no mounted UI', async () => {
  const onError = jest.fn();
  const replacementHandler = jest.fn();
  let rendered!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    rendered = ReactTestRenderer.create(
      <MeldWidget order={order} onError={onError} />,
    );
  });
  expect(rendered.toJSON()).toBeNull();
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledWith({
    orderId: order.id,
    code: 'UNSUPPORTED_NATIVE_PROTOCOL',
    message: 'This app build does not support the order presentation. Update the native app.',
    recoverable: false,
  });
  await act(async () => {
    rendered.update(<MeldWidget order={order} onError={replacementHandler} />);
  });
  expect(replacementHandler).not.toHaveBeenCalled();
  await act(async () => rendered.unmount());
});

test('a compatible binary receives the opaque order and forwards normalized events', async () => {
  NativeModules.MeldModule.headlessProtocolVersion = 1;
  const onError = jest.fn();
  const onStatusChange = jest.fn();
  let rendered!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    rendered = ReactTestRenderer.create(
      <MeldWidget order={order} onError={onError} onStatusChange={onStatusChange} />,
    );
  });
  const native = rendered.root.find(node => node.type === 'MockMeldWidget');
  expect(native.props.order).toBe(order);
  expect(onError).not.toHaveBeenCalled();
  const status = {orderId: order.id, status: 'pending'};
  native.props.onStatusChange({nativeEvent: status});
  expect(onStatusChange).toHaveBeenCalledWith(status);
  await act(async () => rendered.unmount());
});

test('a bridge without the registry mounts a declared order its legacy dispatch presents', async () => {
  const mercuryoCard = {
    id: 'synthetic-card',
    paymentMethodType: 'CREDIT_DEBIT_CARD',
    headlessPresentation: {surface: 'EMBEDDED_WIDGET', protocol: 'MERCURYO_WIDGET', version: 1},
    paymentMethodResponseDetails: {renderMode: 'IFRAME'},
  };
  const onError = jest.fn();
  let rendered!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    rendered = ReactTestRenderer.create(
      <MeldWidget order={mercuryoCard} onError={onError} />,
    );
  });
  const native = rendered.root.find(node => node.type === 'MockMeldWidget');
  expect(native.props.order).toBe(mercuryoCard);
  expect(onError).not.toHaveBeenCalled();
  await act(async () => rendered.unmount());
});

test('a bridge without the registry refuses a registry-only protocol before mounting', async () => {
  const stripe = {
    id: 'synthetic-stripe',
    paymentMethodType: 'APPLE_PAY',
    headlessPresentation: {surface: 'NATIVE_SDK', protocol: 'STRIPE_CRYPTO_ONRAMP', version: 1},
  };
  const onError = jest.fn();
  let rendered!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    rendered = ReactTestRenderer.create(
      <MeldWidget order={stripe} onError={onError} />,
    );
  });
  expect(rendered.toJSON()).toBeNull();
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError.mock.calls[0][0].code).toBe('UNSUPPORTED_NATIVE_PROTOCOL');
  await act(async () => rendered.unmount());
});
