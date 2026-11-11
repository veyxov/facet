import { Directive, computed, input } from '@angular/core';
import { COVER_THUMBNAIL_EDGE, thumbnailSrcset, thumbnailUrl } from '../pipes/thumbnail-url.pipe';

/** Card width per grid, from its Tailwind columns, the `gap-4` gutters and the
 *  page's `px-4`. Overstating it would send a 1x screen the 640 px candidate. */
const COVER_GRID_SIZES = {
  cards: '(min-width: 1280px) calc((100vw - 112px) / 6), (min-width: 1024px) calc((100vw - 96px) / 5), '
    + '(min-width: 768px) calc((100vw - 80px) / 4), (min-width: 640px) calc((100vw - 64px) / 3), calc((100vw - 48px) / 2)',
  albums: '(min-width: 1536px) calc((100vw - 96px) / 5), (min-width: 1024px) calc((100vw - 80px) / 4), '
    + '(min-width: 640px) calc((100vw - 64px) / 3), calc((100vw - 48px) / 2)',
} as const;

export type CoverGrid = keyof typeof COVER_GRID_SIZES;

/** A cover card's image: the browser picks the 320 px resize or the stored
 *  thumbnail for the card's width and pixel density. */
@Directive({
  selector: 'img[appCoverThumbnail]',
  standalone: true,
  host: {
    '[src]': 'src()',
    '[srcset]': 'srcset()',
    '[sizes]': 'sizes()',
    loading: 'lazy',
    decoding: 'async',
  },
})
export class CoverThumbnailDirective {
  readonly path = input.required<string>({ alias: 'appCoverThumbnail' });
  readonly revision = input<string | null | undefined>(null);
  readonly grid = input<CoverGrid>('cards');

  // thumbnailUrl reads the image-key signal, so a session change rebuilds both.
  protected readonly src = computed(() => thumbnailUrl(this.path(), COVER_THUMBNAIL_EDGE, this.revision()));
  protected readonly srcset = computed(() => thumbnailSrcset(this.path(), this.revision()));
  protected readonly sizes = computed(() => COVER_GRID_SIZES[this.grid()]);
}
