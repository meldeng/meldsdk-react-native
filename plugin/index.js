// Resolve `expo/config-plugins` — a re-export off the always-hoisted `expo` package. NOT
// `@expo/config-plugins` directly, which pnpm's strict layout can leave unresolvable and which
// breaks `eas update` config evaluation.
//
// The fallback matters whenever this package is LINKED rather than installed — a monorepo, or a
// worktree wired in with `link:`/`file:`. Node then resolves from this file's real location, which
// is outside the app's tree, and finds no `expo` at all. Falling back to the project root fixes
// that; the plain require stays first so a normally installed package resolves exactly as before.
const loadConfigPlugins = () => {
  try {
    return require('expo/config-plugins');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return require(require.resolve('expo/config-plugins', { paths: [process.cwd()] }));
  }
};

const { withEntitlementsPlist } = loadConfigPlugins();

/**
 * Expo config plugin for native Apple Pay.
 *
 * Adds the Apple Pay In-App Payments entitlement with your merchant id, so PassKit can present the
 * sheet and validate the merchant on-device.
 *
 * This is the one part of Apple Pay the SDK cannot do for you. An Apple merchant identifier belongs
 * to YOUR Apple team and has to be declared by YOUR build — the SDK ships the code that presents
 * the sheet, but the entitlement has to be in the app binary that runs it.
 *
 * Usage in app.json / app.config.js:
 *
 *   "plugins": [
 *     ["@meldcrypto/react-native-sdk/plugin", { "merchantId": "merchant.com.yourcompany.app" }]
 *   ]
 *
 * The merchant id MUST be:
 *   - registered in your Apple Developer account, with the Apple Pay capability enabled on the
 *     App ID, and
 *   - paired with a Payment Processing certificate issued from the CSR your Meld representative
 *     provides. The processor holds that private key and decrypts the token — never generate the
 *     payment processing key yourself, or no payment can be decrypted.
 *
 * Enabling the entitlement also drives the Apple Pay capability on the App ID; EAS managed
 * credentials picks it up at build time.
 *
 * Only needed for providers whose Apple Pay is presented natively. A provider-hosted surface runs
 * on the provider's own registered domain under their merchant id, and needs none of this.
 */
const withMeldApplePay = (config, props = {}) => {
  const merchantId = props.merchantId;
  if (!merchantId) {
    throw new Error(
      '@meldcrypto/react-native-sdk/plugin requires a { merchantId } ' +
        '(e.g. "merchant.com.yourcompany.app").',
    );
  }
  return withEntitlementsPlist(config, (cfg) => {
    cfg.modResults['com.apple.developer.in-app-payments'] = [merchantId];
    return cfg;
  });
};

module.exports = withMeldApplePay;
