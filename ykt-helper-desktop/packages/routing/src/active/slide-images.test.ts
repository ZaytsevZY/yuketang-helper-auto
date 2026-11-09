import { BrowserEnvironment } from '@ykt/contracts';
import { describe, expect, it } from 'vitest';
import { hostAdapterFor } from './host-adapter.js';

describe('courseware image fields', () => {
  it.each(['coverAlt', 'image', 'thumbnail', 'cover_url', 'src'])(
    'reads %s from a question slide',
    (field) => {
      const deck = hostAdapterFor(
        BrowserEnvironment.Standard,
      ).parsePresentation(
        {
          data: {
            slides: [
              {
                id: 'slide',
                imageUrl: '',
                [field]: 'https://example.com/question.png',
              },
            ],
          },
        },
        'lesson',
        'deck',
      );
      expect(deck.slides[0]?.imageUrl).toBe('https://example.com/question.png');
    },
  );
});
