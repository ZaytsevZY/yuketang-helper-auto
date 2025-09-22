// src/ui/styles.js
import { gm } from '../core/env.js';
import css from './styles.css';

export function injectStyles() {
  gm.addStyle(css);
}

