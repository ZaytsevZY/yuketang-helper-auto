const path = require('node:path');
const { packagerConfig, checkTarget } = require('./forge.shared.cjs');

function createConfig(env = process.env) {
  const release = env.YKT_MAC_RELEASE === '1';
  const identity = env.YKT_MAC_SIGN_IDENTITY?.trim();
  const keychainProfile = env.YKT_MAC_NOTARY_PROFILE?.trim();
  if (release && (!identity || identity === '-' || !keychainProfile)) {
    throw new Error(
      'macOS 正式发行需要 YKT_MAC_SIGN_IDENTITY（Developer ID Application 证书）和 YKT_MAC_NOTARY_PROFILE（钥匙串中的公证凭据名称）。',
    );
  }
  return {
    outDir: path.join(__dirname, 'out', 'macos', release ? 'release' : 'local'),
    packagerConfig: {
      ...packagerConfig(),
      appBundleId: 'cn.yuketang.helper.desktop',
      appCategoryType: 'public.app-category.education',
      // Add the CLI launcher before signing; never modify a signed .app in
      // postPackage, which would invalidate the resource seal and notarization.
      extraResource: [
        ...packagerConfig().extraResource,
        path.join(__dirname, 'build', 'macos', 'ykt'),
      ],
      osxSign: release
        ? {
            identity,
            continueOnError: false,
            // Retain osx-sign's per-process Electron entitlements and hardened runtime.
          }
        : {
            identity: '-',
            identityValidation: false,
            preAutoEntitlements: false,
            preEmbedProvisioningProfile: false,
            continueOnError: false,
            optionsForFile: () => ({
              hardenedRuntime: false,
              timestamp: 'none',
            }),
          },
      ...(release ? { osxNotarize: { keychainProfile } } : {}),
    },
    hooks: {
      generateAssets: async (_config, platform, arch) => {
        checkTarget('darwin', platform, arch);
        if (process.platform !== 'darwin')
          throw new Error('macOS 打包和签名必须在 macOS 上执行。');
      },
    },
    makers: [
      {
        name: '@electron-forge/maker-dmg',
        platforms: ['darwin'],
        config: { format: 'UDZO' },
      },
      { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
    ],
  };
}

module.exports = { createConfig };
