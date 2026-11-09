const { copyFile, readdir, rm, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { packagerConfig, checkTarget } = require('./forge.shared.cjs');

function createConfig(env = process.env) {
  const portable = env.YKT_PORTABLE === '1';
  return {
    outDir: path.join(
      __dirname,
      'out',
      'windows',
      portable ? 'portable' : 'installer',
    ),
    packagerConfig: {
      ...packagerConfig(),
      icon: path.join(__dirname, 'build', 'icon.ico'),
    },
    hooks: {
      generateAssets: async (_config, platform, arch) =>
        checkTarget('win32', platform, arch),
      postPackage: async (_config, result) => {
        checkTarget('win32', result.platform, result.arch);
        for (const outputPath of result.outputPaths) {
          const localesPath = path.join(outputPath, 'locales');
          const localeFiles = await readdir(localesPath, {
            withFileTypes: true,
          });
          await Promise.all(
            localeFiles
              .filter(
                (entry) =>
                  entry.isFile() && !/^(?:en|zh)(?:-|\.)/i.test(entry.name),
              )
              .map((entry) => rm(path.join(localesPath, entry.name))),
          );
          await rm(path.join(outputPath, 'ykt-helper-data'), {
            recursive: true,
            force: true,
          });
          await copyFile(
            path.join(__dirname, 'build', 'ykt.cmd'),
            path.join(outputPath, 'ykt.cmd'),
          );
          if (portable) {
            await writeFile(
              path.join(outputPath, 'portable.flag'),
              'portable\n',
            );
          } else {
            await rm(path.join(outputPath, 'portable.flag'), { force: true });
          }
        }
      },
    },
    makers: portable
      ? [{ name: '@electron-forge/maker-zip', platforms: ['win32'] }]
      : [
          {
            name: '@electron-forge/maker-squirrel',
            platforms: ['win32'],
            config: {
              name: 'YuketangHelper',
              authors: 'Yuketang Helper contributors',
              description: '雨课堂助手 Windows 桌面端',
              additionalFiles: [{ src: 'ykt.cmd', target: 'lib\\net45' }],
              setupExe: 'YuketangHelper-Setup.exe',
              setupIcon: path.join(__dirname, 'build', 'icon.ico'),
            },
          },
        ],
  };
}

module.exports = { createConfig };
