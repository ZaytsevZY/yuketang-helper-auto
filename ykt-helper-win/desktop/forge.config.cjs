const { copyFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

const portable = process.env.YKT_PORTABLE === '1';

module.exports = {
  packagerConfig: {
    asar: true,
    download: {
      cacheRoot: path.join(__dirname, '.electron-cache'),
    },
    executableName: 'YuketangHelper',
    icon: path.join(__dirname, 'build', 'icon'),
    extraResource: [path.join(__dirname, 'cli', 'ykt-cli.cjs')],
    ignore: [
      /^\/\.electron-cache($|\/)/,
      /^\/build($|\/)/,
      /^\/cli($|\/)/,
      /^\/out($|\/)/,
      /^\/forge\.config\.cjs$/,
      /^\/README\.md$/,
    ],
  },
  hooks: {
    postPackage: async (_forgeConfig, result) => {
      for (const outputPath of result.outputPaths) {
        await copyFile(
          path.join(__dirname, 'build', 'ykt.cmd'),
          path.join(outputPath, 'ykt.cmd'),
        );
        if (portable) {
          await writeFile(path.join(outputPath, 'portable.flag'), 'portable\n');
        }
      }
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'YuketangHelper',
        authors: 'Yuketang Helper contributors',
        description: '雨课堂助手 Windows 桌面端',
        additionalFiles: [{ src: 'ykt.cmd', target: 'lib\\net45' }],
        setupExe: 'YuketangHelper-Setup.exe',
        setupIcon: path.join(__dirname, 'build', 'icon.ico'),
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
  ],
};
