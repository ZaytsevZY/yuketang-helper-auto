// Select the target explicitly: the build host must not select Windows hooks
// for a macOS bundle (or vice versa).
switch (process.env.YKT_PACKAGE_PLATFORM) {
  case 'win32':
    module.exports = require('./forge.windows.config.cjs').createConfig();
    break;
  case 'darwin':
    module.exports = require('./forge.macos.config.cjs').createConfig();
    break;
  default:
    throw new Error(
      '请使用 make:win、make:portable、make:mac 或 make:mac:release 选择打包平台。',
    );
}
