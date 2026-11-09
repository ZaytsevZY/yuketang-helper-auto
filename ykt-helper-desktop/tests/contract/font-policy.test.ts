import { describe, expect, it } from 'vitest';
import {
  inspectFontSource,
  invalidFontFamily,
} from '../../scripts/check-font-policy.mjs';

describe('font policy', () => {
  it.each(['inherit', 'initial', 'unset', 'revert', 'revert-layer'])(
    'rejects %s in a family list, but allows it standalone or quoted',
    (keyword) => {
      expect(invalidFontFamily(`"YktEncrypted", ${keyword}`)).toBe(true);
      expect(invalidFontFamily(`${keyword}, sans-serif`)).toBe(true);
      expect(invalidFontFamily(`${keyword.toUpperCase()} !important`)).toBe(
        false,
      );
      expect(invalidFontFamily(`"${keyword}", sans-serif`)).toBe(false);
    },
  );

  it('handles comments, escaped identifiers, quoted commas and fallback variables', () => {
    expect(invalidFontFamily('"Ykt", /* fallback */ INHERIT')).toBe(true);
    expect(invalidFontFamily('"Ykt", \\69 nherit')).toBe(true);
    expect(invalidFontFamily('"Font, inherit", var(--ykt-font-body)')).toBe(
      false,
    );
    expect(invalidFontFamily('"Microsoft YaHei", system-ui, sans-serif')).toBe(
      false,
    );
    expect(invalidFontFamily('/* comment */ inherit /* comment */')).toBe(
      false,
    );
    // Custom property substitution must be checked at runtime, not guessed here.
    expect(invalidFontFamily('var(--unknown-font-stack)')).toBe(false);
  });

  it.each([
    ['theme.css', '.encrypted { font-family: "Ykt", inherit; }'],
    [
      'Panel.vue',
      '<style scoped>.encrypted { font-family: "Ykt", unset; }</style>',
    ],
    [
      'page.html',
      '<span style="font-family: &quot;Ykt&quot;, initial">text</span>',
    ],
    ['styles.ts', 'const style = { fontFamily: `"${family}", inherit` };'],
    ['styles.js', 'node.style.fontFamily = \'"Ykt", revert\';'],
    ['styles.ts', 'node.style["font-family"] = \'"Ykt", revert-layer\';'],
    ['styles.ts', 'node.style.setProperty("font-family", \'"Ykt", unset\');'],
    [
      'styles.ts',
      'const css = `<style>.encrypted { font-family: "${family}", inherit; }</style>`;',
    ],
    ['styles.ts', 'const style = { "font-family": family + ", inherit" };'],
  ])('finds invalid declarations in %s: %s', (filename, source) => {
    expect(inspectFontSource(source, filename)).toHaveLength(1);
  });

  it('does not flag legal inheritance, quoted family names or comments', () => {
    expect(
      inspectFontSource(
        `
      /* .old { font-family: "Ykt", inherit; } */
      .message { font-family: inherit; }
      .named { font-family: "inherit", sans-serif; }
    `,
        'theme.css',
      ),
    ).toEqual([]);
    expect(
      inspectFontSource(
        `
      // node.style.fontFamily = 'Ykt, inherit';
      const style = { fontFamily: 'inherit' };
      const text = 'inherit';
    `,
        'styles.ts',
      ),
    ).toEqual([]);
  });
});
