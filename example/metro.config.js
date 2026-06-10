const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// The wrapper is linked from the repo root via `file:..`, so its real source lives outside this
// example. Let Metro watch the repo root, and pin the wrapper's peer deps (react, react-native)
// to this example's node_modules so there's a single copy.
const root = path.resolve(__dirname, '..');
const peerDeps = Object.keys(require('../package.json').peerDependencies || {});

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [root],
  resolver: {
    extraNodeModules: peerDeps.reduce((acc, name) => {
      acc[name] = path.resolve(__dirname, 'node_modules', name);
      return acc;
    }, {}),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
