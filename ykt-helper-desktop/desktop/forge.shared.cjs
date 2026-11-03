const path = require('node:path');

function packagerConfig() {
  return {
    asar: true,
    executableName: 'YuketangHelper',
    download: { cacheRoot: path.join(__dirname, '.electron-cache') },
    extraResource: [path.join(__dirname, 'cli', 'ykt-cli.cjs')],
    // Only the prepared runtime enters app.asar. Build credentials, configs,
    // platform scripts, caches and previous artifacts must never be included.
    ignore: [
      /^\/(?!main(?:\/|$)|preload(?:\/|$)|renderer(?:\/|$)|package\.json$|node_modules(?:\/|$))/,
    ],
  };
}

function checkTarget(expected, platform, arch) {
  if (platform !== expected)
    throw new Error(`打包平台不匹配：配置为 ${expected}，请求为 ${platform}。`);
  const supported = expected === 'darwin' ? ['arm64', 'x64'] : ['x64'];
  if (!supported.includes(arch))
    throw new Error(`不支持 ${platform}/${arch} 打包。`);
}

module.exports = { packagerConfig, checkTarget };
