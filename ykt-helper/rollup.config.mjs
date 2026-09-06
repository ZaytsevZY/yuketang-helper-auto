import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import string from '@bkuri/rollup-plugin-string';
import terser from '@rollup/plugin-terser';
import { meta } from './userscript.meta.js';

/** 产物文件名 */
export const OUT_FILE = 'dist/ykt-helper-1213.user.js';
export const DEBUG_OUT_FILE = 'dist/ykt-helper.debug.user.js';

const makeOutput = (file) => ({
  file,
  format: 'iife',
  sourcemap: false,
  banner: () => meta,
  inlineDynamicImports: true
});

const stripTrailingWhitespace = () => ({
  name: 'strip-trailing-whitespace',
  generateBundle(_options, bundle) {
    for (const output of Object.values(bundle)) {
      if (output.type === 'chunk') output.code = output.code.replace(/[ \t]+$/gm, '');
    }
  }
});

export default {
  input: 'src/index.js',
  // 版本化产物用于发布；固定文件名专供本地调试页，避免每次升级版本都修改 HTML。
  output: [makeOutput(OUT_FILE), makeOutput(DEBUG_OUT_FILE)],
  plugins: [
    // 允许 import 模板与样式为字符串（与现有用法一致）
    string({ include: ['**/*.html', '**/*.css'] }),

    // 解析依赖 / CJS 转 ESM
    resolve({ 
      browser: true, 
      preferBuiltins: false,
      // 确保所有依赖都被内联
      exportConditions: ['browser']
    }),
    commonjs(),

    // 编译期替换
    replace({
      preventAssignment: true,
      values: {
        __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
        __BUILD_VERSION__: JSON.stringify(process.env.BUILD_VERSION || 'dev')
      }
    }),

    // 仅做"美化 + 保留注释"，禁止激进压缩/混淆
    terser({
      mangle: false,                 // 不混淆，便于阅读/调试
      compress: {
        // 彻底关闭大多数压缩手段，避免逗号表达式/return-assign 等
        defaults: false,
        sequences: false            // 禁止合并为 a(),b() 这种逗号表达式
      },
      format: {
        beautify: true,              // 多行可读
        indent_level: 2,
        comments: 'all'              // 保留全部注释（尤其是 Userscript 头）
      }
    }),

    // 新增的发布包会整体进入 Git；统一清理生成代码行尾空格，保证 diff 检查干净。
    stripTrailingWhitespace()
  ],
  
  // 关键配置：禁用代码分割相关功能
  external: [],  // 不外部化任何模块
  
  // 如果有 treeshaking 问题，可以适当调整
  treeshake: {
    moduleSideEffects: true  // 保持模块副作用，避免过度摇树
  }
};
