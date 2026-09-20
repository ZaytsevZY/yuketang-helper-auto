# KaTeX 0.16.22

MIT licensed offline math renderer and fonts. Vendored from the KaTeX artifacts
included in OneTHU PR #32, commit `5225a05b72b091767eddf670c9391004d63b10af`.

- `katex.mjs`: upstream npm `katex@0.16.22/dist/katex.mjs`.
- `katex.d.mts`: upstream `types/katex.d.ts` with the ESM declaration extension.
- `katexInlineCss.ts`: upstream minified CSS with WOFF2 font URLs replaced by
  inline base64. This lets opaque-origin sandbox documents render offline.
- `LICENSE`: original MIT notice; also shipped in `renderer/public/licenses`.

Do not hand-edit vendor artifacts. When upgrading, regenerate the CSS from the
same KaTeX release's fonts and keep the license copy in sync. Application glue,
HTML sanitization, font readiness and formula limits live in `assignment-body.ts`.
