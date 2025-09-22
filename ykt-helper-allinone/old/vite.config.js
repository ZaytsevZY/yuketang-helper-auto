import { defineConfig } from 'vite';
import pathlib from 'path';
import vue from '@vitejs/plugin-vue';
import monkey, { cdn } from 'vite-plugin-monkey';

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': pathlib.resolve(__dirname, "./src"),
    },
  },
  plugins: [
    vue(),
    monkey({
      entry: 'src/main.js',
      userscript: {
        name: '雨课堂 helper',
        version: '1.5.0',
        description: '雨课堂辅助工具：课堂习题提示，自动作答习题',
        author: 'hotwords123',
        match: [
          'https://*.yuketang.cn/lesson/fullscreen/v3/*',
          'https://*.yuketang.cn/v2/web/*',
        ],
        icon: 'https://www.google.com/s2/favicons?sz=64&domain=yuketang.cn',
        namespace: 'https://github.com/hotwords123/yuketang-helper',
        "run-at": "document-start",
      },
      build: {
        externalGlobals: {
          vue: cdn.jsdelivr('Vue', 'dist/vue.global.prod.js'),
          jspdf: cdn.jsdelivr('jspdf', 'dist/jspdf.umd.min.js'),
        },
      },
    }),
  ],
});
