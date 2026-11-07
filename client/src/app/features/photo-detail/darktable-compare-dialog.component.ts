import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Photo } from '../../shared/models/photo.model';
import { thumbnailUrl, imageUrl, STORED_THUMBNAIL_EDGE, RENDERED_THUMBNAIL_EDGE } from '../../shared/pipes/thumbnail-url.pipe';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { i18nKeys } from '../../core/i18n/keys';
import { SyncedZoomComponent, ZoomState, FIT_ZOOM } from '../gallery/synced-zoom.component';

const STORED_EDGE = STORED_THUMBNAIL_EDGE;
const RENDERED_EDGE = RENDERED_THUMBNAIL_EDGE;

/** A photo's original beside its darktable edit, in the gallery's synced pan/zoom panes. */
@Component({
  selector: 'app-darktable-compare-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule, SyncedZoomComponent, TranslatePipe],
  template: `
    <div class="flex h-full flex-col bg-black">
      <div class="flex shrink-0 items-center gap-2 px-3 py-2 text-sm text-white/90">
        <mat-icon class="!h-5 !w-5 !text-base !leading-5" aria-hidden="true">compare</mat-icon>
        <span class="flex-1 truncate">{{ I18N.darktable_edit.compare | translate }}</span>
        @if (zoomed()) {
          <button mat-icon-button class="!text-white" [matTooltip]="I18N.gallery.compare.reset_zoom | translate"
                  [attr.aria-label]="I18N.gallery.compare.reset_zoom | translate" (click)="zoom.set({ scale: 1, tx: 0, ty: 0 })">
            <mat-icon>zoom_out_map</mat-icon>
          </button>
        }
        <button mat-icon-button class="!text-white" [matTooltip]="I18N.dialog.close | translate"
                [attr.aria-label]="I18N.dialog.close | translate" (click)="ref.close()">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      <div class="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-1 p-1 sm:grid-cols-2 sm:grid-rows-1">
        @for (pane of panes(); track pane.key) {
          <div class="relative h-full min-h-0 w-full overflow-hidden rounded">
            <app-synced-zoom class="h-full min-h-0 w-full" [src]="pane.src" [placeholderSrc]="pane.placeholder"
                             [fullResSrc]="pane.full" [frameKey]="pane.key" [zoom]="zoom()"
                             (zoomChange)="zoom.set($event)" [alt]="pane.label | translate" />
            <div class="pointer-events-none absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate rounded bg-black/60 px-2 py-0.5 text-xs text-white">{{ pane.label | translate }}</div>
          </div>
        }
      </div>
      <div class="shrink-0 px-3 py-2 text-center text-xs text-white/60">{{ I18N.darktable_edit.compare_hint | translate }}</div>
    </div>
  `,
  host: { class: 'block h-full' },
})
export class DarktableCompareDialogComponent {
  protected readonly I18N = i18nKeys();
  protected readonly ref = inject(MatDialogRef<DarktableCompareDialogComponent>);
  private readonly data = inject<{ photo: Photo }>(MAT_DIALOG_DATA);

  protected readonly zoom = signal<ZoomState>({ ...FIT_ZOOM });
  protected readonly zoomed = computed(() => this.zoom().scale > FIT_ZOOM.scale);

  protected readonly panes = computed(() => {
    const p = this.data.photo;
    // `original=1` makes the server skip the darktable rendition; the edit is the default.
    const pane = (original: boolean, label: string) => {
      const extra = original ? '&original=1' : '';
      return {
        key: p.path + extra,
        label,
        src: thumbnailUrl(p.path, RENDERED_EDGE, p.preview_revision) + extra,
        placeholder: thumbnailUrl(p.path, STORED_EDGE, p.preview_revision) + extra,
        full: imageUrl(p.path, true, p.preview_revision) + extra,
      };
    };
    return [pane(true, this.I18N.darktable_edit.original), pane(false, this.I18N.darktable_edit.edited)];
  });
}
