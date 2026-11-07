import { ChangeDetectionStrategy, Component, computed, DestroyRef, NgZone, OnInit, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { i18nKeys } from '../../core/i18n/keys';
import { thumbnailUrl, RENDERED_THUMBNAIL_EDGE } from '../../shared/pipes/thumbnail-url.pipe';
import { downloadBlob } from '../../shared/utils/download';

interface EditState {
  enabled: boolean;
  available: boolean;
  edited: boolean;
  token: string;
  sidecar: string | null;
}

@Component({
  selector: 'app-darktable-edit-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ I18N.darktable_edit.title | translate }}</h2>
    <mat-dialog-content class="!pt-2 max-w-lg !flex !flex-col gap-4">
      <p class="m-0">{{ I18N.darktable_edit.instructions | translate }}</p>
      @if (error()) {
        <p role="alert" class="m-0">{{ failureKey() | translate }}</p>
        <button mat-button (click)="load()" [disabled]="busy()">{{ I18N.darktable_edit.reload | translate }}</button>
      }
      @if (state(); as s) {
        @if (!s.enabled || !s.available) {
          <p class="m-0">{{ I18N.darktable_edit.setup | translate }}</p>
        }
        <div class="flex flex-wrap items-center gap-2">
          <button mat-flat-button (click)="run('open')" [disabled]="busy() || !s.enabled || !s.available || error()">
            {{ I18N.darktable_edit.open | translate }}
          </button>
          <button mat-stroked-button (click)="run('apply')" [disabled]="busy() || !s.enabled || !s.available || error()">
            {{ I18N.darktable_edit.apply | translate }}
          </button>
          @if (busy()) {
            <mat-spinner diameter="24" [attr.aria-label]="I18N.ui.labels.loading | translate" />
          }
        </div>
        @if (watching() && !busy()) {
          <p role="status" class="m-0 flex items-center gap-2 text-sm opacity-80">
            <mat-spinner diameter="14" aria-hidden="true" />
            {{ I18N.darktable_edit.watching | translate }}
          </p>
        }
        @if (s.edited) {
          <section class="flex flex-col gap-2" [attr.aria-label]="I18N.darktable_edit.current_edit | translate">
            <h3 class="m-0 text-sm font-medium">{{ I18N.darktable_edit.current_edit | translate }}</h3>
            <div class="grid grid-cols-2 gap-3">
              <figure class="m-0 space-y-1">
                <figcaption class="text-sm opacity-70" aria-hidden="true">{{ I18N.darktable_edit.original | translate }}</figcaption>
                <img class="max-h-56 w-full rounded object-contain" [src]="original()" [alt]="I18N.darktable_edit.original | translate" />
              </figure>
              <figure class="m-0 space-y-1">
                <figcaption class="text-sm opacity-70" aria-hidden="true">{{ I18N.darktable_edit.edited | translate }}</figcaption>
                <img class="max-h-56 w-full rounded object-contain" [src]="edited()" [alt]="I18N.darktable_edit.edited | translate" />
              </figure>
            </div>
            <div class="flex flex-wrap gap-2">
              <button mat-button (click)="download()" [disabled]="busy() || error()">{{ I18N.darktable_edit.download | translate }}</button>
              <button mat-button (click)="run('revert')" [disabled]="busy() || !s.enabled || error()">{{ I18N.darktable_edit.revert | translate }}</button>
            </div>
          </section>
        }
      } @else if (busy()) {
        <mat-spinner diameter="28" [attr.aria-label]="I18N.ui.labels.loading | translate" />
      }
      <details class="group text-sm opacity-80">
        <summary class="flex min-h-11 cursor-pointer items-center gap-1">
          <mat-icon class="transition-transform group-open:rotate-180" aria-hidden="true">expand_more</mat-icon>
          {{ I18N.darktable_edit.details | translate }}
        </summary>
        <p class="mt-0">{{ I18N.darktable_edit.preservation | translate }}</p>
      </details>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [disabled]="busy()" (click)="close()">{{ I18N.darktable_edit.close | translate }}</button>
    </mat-dialog-actions>
  `,
})
export class DarktableEditDialogComponent implements OnInit {
  protected readonly I18N = i18nKeys();
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly ref = inject(MatDialogRef<DarktableEditDialogComponent>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  readonly data = inject<{ path: string }>(MAT_DIALOG_DATA);
  readonly state = signal<EditState | null>(null);
  readonly original = computed(() => `${thumbnailUrl(this.data.path, RENDERED_THUMBNAIL_EDGE)}&original=1`);
  // The token changes on every state load, which busts the browser cache after apply/revert.
  readonly edited = computed(() => `${thumbnailUrl(this.data.path, RENDERED_THUMBNAIL_EDGE)}&rev=${encodeURIComponent(this.state()?.token ?? '')}`);
  readonly busy = signal(false);
  protected readonly watching = signal(false);
  readonly error = signal(false);
  private readonly failed = signal<'load' | 'open' | 'apply' | 'revert' | 'download'>('load');
  protected readonly failureKey = computed(() => ({
    load: this.I18N.darktable_edit.failed,
    open: this.I18N.darktable_edit.failed_open,
    apply: this.I18N.darktable_edit.failed_apply,
    revert: this.I18N.darktable_edit.failed_revert,
    download: this.I18N.darktable_edit.failed_download,
  })[this.failed()]);
  private readonly identity = this.auth.identity();
  private readonly sessionToken = this.auth.token;
  private changed: 'apply' | 'revert' | false = false;
  private baseline: string | null = null;
  private seen: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    void this.load();
    this.destroyRef.onDestroy(() => this.stopWatching());
  }

  private stopWatching(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.watching.set(false);
  }

  // darktable has no save button: it writes the XMP sidecar itself. Apply once that file changes and settles.
  private startWatching(baseline: string | null): void {
    this.stopWatching();
    this.baseline = baseline;
    this.seen = null;
    // Outside the zone so the endless timer never keeps the app "unstable".
    this.zone.runOutsideAngular(() => { this.timer = setInterval(() => void this.poll(), 2000); });
    this.watching.set(true);
  }

  private async poll(): Promise<void> {
    if (this.busy() || !this.current()) return;
    try {
      const next = await firstValueFrom(this.api.get<EditState>('/photo/darktable', { path: this.data.path }));
      if (this.busy() || !this.current() || next.sidecar === this.baseline) return;
      // darktable creates the sidecar on import, before any edit exists; that is not an edit.
      if (this.baseline === null) { this.baseline = next.sidecar; return; }
      if (next.sidecar !== this.seen) { this.seen = next.sidecar; return; }
      this.state.set(next);
      this.stopWatching();
      await this.run('apply');
      // A failed apply leaves the dialog open: keep watching for the next save.
      if (this.error() && !this.destroyRef.destroyed) this.startWatching(next.sidecar);
    } catch { /* transient; the next tick retries */ }
  }

  private current(): boolean {
    return !this.destroyRef.destroyed && this.auth.isEdition() && this.auth.identity() === this.identity && this.auth.token === this.sessionToken;
  }

  async load(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(false);
    try {
      const state = await firstValueFrom(this.api.get<EditState>('/photo/darktable', { path: this.data.path }));
      if (this.current()) {
        this.state.set(state);
        if (!this.timer) this.startWatching(state.sidecar);
      }
    } catch {
      if (this.current()) { this.failed.set('load'); this.error.set(true); }
    } finally {
      if (!this.destroyRef.destroyed) this.busy.set(false);
    }
  }

  async run(action: 'open' | 'apply' | 'revert'): Promise<void> {
    const state = this.state();
    if (!state || this.busy() || !this.current()) return;
    this.busy.set(true);
    this.ref.disableClose = true;
    this.error.set(false);
    try {
      const next = await firstValueFrom(this.api.post<EditState>(`/photo/darktable/${action}`, {
        path: this.data.path, token: state.token,
      }));
      if (!this.current()) return;
      this.state.set(next);
      if (action === 'open') this.startWatching(next.sidecar);
      else {
        this.changed = action;
        // Publish the successful result immediately; Escape cannot lose it later.
        this.ref.close(action);
      }
    } catch {
      if (this.current()) { this.failed.set(action); this.error.set(true); }
    } finally {
      if (!this.destroyRef.destroyed) {
        this.busy.set(false);
        this.ref.disableClose = false;
      }
    }
  }

  async download(): Promise<void> {
    if (this.busy() || !this.current()) return;
    this.busy.set(true);
    try {
      const data = await firstValueFrom(this.api.getRaw(`/api/photo/darktable/download?${new URLSearchParams({ path: this.data.path })}`));
      if (!this.current()) return;
      downloadBlob(data, 'edited.jxl');
    } catch {
      if (this.current()) { this.failed.set('download'); this.error.set(true); }
    } finally {
      if (!this.destroyRef.destroyed) this.busy.set(false);
    }
  }

  close(): void { this.ref.close(this.changed); }
}
