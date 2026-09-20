import { parentPort } from 'node:worker_threads';
import { analyzeWebSource } from './web-source-analysis.js';

parentPort?.on(
  'message',
  ({ source, url }: { source: string; url: string }) => {
    parentPort?.postMessage(analyzeWebSource(source, url));
  },
);
