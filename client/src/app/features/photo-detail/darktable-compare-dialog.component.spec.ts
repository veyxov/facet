import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import { DarktableCompareDialogComponent } from './darktable-compare-dialog.component';
import { SyncedZoomComponent } from '../gallery/synced-zoom.component';
import { Photo } from '../../shared/models/photo.model';
import { I18nService } from '../../core/services/i18n.service';

describe('DarktableCompareDialogComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  function build() {
    TestBed.configureTestingModule({
      imports: [DarktableCompareDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { photo: { path: '/a.jpg', filename: 'a.jpg', preview_revision: 'dt-1' } as Photo } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: I18nService, useValue: { t: (k: string) => k, translations: () => ({}) } },
      ],
    });
    const fixture = TestBed.createComponent(DarktableCompareDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('shows the original beside the edit in two linked panes', () => {
    const panes = build().debugElement.queryAll(By.directive(SyncedZoomComponent))
      .map(de => de.componentInstance as SyncedZoomComponent);
    expect(panes.length).toBe(2);
    expect(panes[0].src()).toContain('original=1');
    expect(panes[0].fullResSrc()).toContain('original=1');
    expect(panes[1].src()).not.toContain('original');
    expect(panes[0].frameKey()).not.toBe(panes[1].frameKey());
  });

  it('a zoom on one pane drives the other', () => {
    const fixture = build();
    const panes = fixture.debugElement.queryAll(By.directive(SyncedZoomComponent))
      .map(de => de.componentInstance as SyncedZoomComponent);
    panes[0].zoomChange.emit({ scale: 3, tx: 10, ty: 5 });
    fixture.detectChanges();
    expect(panes[1].zoom()).toEqual({ scale: 3, tx: 10, ty: 5 });
  });
});
