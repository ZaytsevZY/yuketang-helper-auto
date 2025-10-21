import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import string from '@bkuri/rollup-plugin-string';
import terser from '@rollup/plugin-terser';
import { meta } from './userscript.meta.js';

/** 产物文件名 */
const OUT_FILE = 'dist/ykt-helper-1190.user.js';

export default {
  input: 'src/index.js',
  output: {
    file: OUT_FILE,
    format: 'iife',         // Userscript 友好
    sourcemap: false,
    // ✅ 把 Userscript 头部固定注入到产物顶部
    banner: () => meta,
    // ✅ 强制禁用代码分割，将所有代码打包到一个文件
    inlineDynamicImports: true
  },
  plugins: [
    // 允许 import 模板与样式为字符串（与现有用法一致）
    string({ include: ['**/*.html', '**/*.css'] }),

    // 解析依赖 / CJS 转 ESM
    resolve({ 
      browser: true, 
      preferBuiltins: false,
      // ✅ 确保所有依赖都被内联
      exportConditions: ['browser']
    }),
    commonjs(),

    // 编译期替换（可保留你已有变量）
    replace({
      preventAssignment: true,
      values: {
        __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
        __BUILD_VERSION__: JSON.stringify(process.env.BUILD_VERSION || 'dev')
      }
    }),

    // ✅ 仅做"美化 + 保留注释"，禁止激进压缩/混淆
    terser({
      mangle: false,                 // 不混淆，便于阅读/调试
      compress: {
        // 彻底关闭大多数压缩手段，避免逗号表达式/return-assign 等
        defaults: false,
        sequences: false            // 禁止合并为 a(),b() 这种逗号表达式
      },
      format: {
        beautify: true,              // ✅ 多行可读
        indent_level: 2,
        comments: 'all'              // ✅ 保留全部注释（尤其是 Userscript 头）
      }
    })
  ],
  
  // ✅ 关键配置：禁用代码分割相关功能
  external: [],  // 不外部化任何模块
  
  // ✅ 如果有 treeshaking 问题，可以适当调整
  treeshake: {
    moduleSideEffects: true  // 保持模块副作用，避免过度摇树
  }
};