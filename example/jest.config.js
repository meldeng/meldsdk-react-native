module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // The SDK ships raw TS/TSX (its package main points at src/), so Babel must transform it too —
  // it isn't pre-compiled like a typical npm dep. Add it to the RN preset's allowlist.
  transformIgnorePatterns: [
    'node_modules/(?!(?:.pnpm/)?(@react-native|react-native|@react-native-community|@meldcrypto)/)',
  ],
};
