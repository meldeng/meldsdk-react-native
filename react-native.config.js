// Tells React Native autolinking how to register the Android package (and to skip the example
// app as a dependency). iOS autolinks via the podspec.
module.exports = {
  dependency: {
    platforms: {
      android: {
        packageImportPath: 'import io.meld.rn.MeldPackage;',
        packageInstance: 'new MeldPackage()',
      },
    },
  },
};
