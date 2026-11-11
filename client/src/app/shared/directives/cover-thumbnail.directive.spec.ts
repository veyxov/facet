import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { privateImageCacheKey, resetPrivateImageSession } from '../utils/private-image-session';
import { CoverGrid, CoverThumbnailDirective } from './cover-thumbnail.directive';

@Component({
  imports: [CoverThumbnailDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<img alt="" [appCoverThumbnail]="path()" [revision]="revision()" [grid]="grid()" />`,
})
class CoverHost {
  readonly path = signal('/photos/a, b.jpg');
  readonly revision = signal<string | null>('r1');
  readonly grid = signal<CoverGrid>('cards');
}

async function render() {
  const fixture = TestBed.createComponent(CoverHost);
  fixture.autoDetectChanges();
  await fixture.whenStable();
  const img = (fixture.nativeElement as HTMLElement).querySelector('img')!;
  return { fixture, img };
}

const candidates = (img: HTMLImageElement) =>
  img.getAttribute('srcset')!.split(', ').map((c) => {
    const [url, w] = c.split(' ');
    return { url: new URL(url, 'http://facet.test'), w };
  });

describe('CoverThumbnailDirective', () => {
  it('offers the 320 px resize and the stored thumbnail, lazily, with the 320 px one as src', async () => {
    const { img } = await render();
    const set = candidates(img);
    expect(set.map((c) => c.w)).toEqual(['320w', '640w']);
    for (const { url, w } of set) {
      expect(url.searchParams.get('path')).toBe('/photos/a, b.jpg');
      expect(url.searchParams.get('size')).toBe(w.slice(0, -1));
      expect(url.searchParams.get('preview')).toBe('r1');
    }
    expect(new URL(img.src).searchParams.get('size')).toBe('320');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('sizes')).toContain('calc((100vw - 112px) / 6)');
  });

  it('describes the albums grid when asked', async () => {
    const { fixture, img } = await render();
    fixture.componentInstance.grid.set('albums');
    await fixture.whenStable();
    expect(img.getAttribute('sizes')).toContain('(min-width: 1536px) calc((100vw - 96px) / 5)');
  });

  it('rebuilds src and srcset when only the image session rotates', async () => {
    const { fixture, img } = await render();
    const before = [img.getAttribute('src'), img.getAttribute('srcset')];
    resetPrivateImageSession();
    // No input change and no manual detectChanges: the image key alone must drive it.
    await fixture.whenStable();
    expect([img.getAttribute('src'), img.getAttribute('srcset')]).not.toEqual(before);
    for (const { url } of candidates(img)) {
      expect(url.searchParams.get('session')).toBe(privateImageCacheKey());
    }
    expect(new URL(img.src).searchParams.get('session')).toBe(privateImageCacheKey());
  });
});
