import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DarktableEditDialogComponent } from './darktable-edit-dialog.component';
import { AuthService } from '../../core/services/auth.service';
import { I18nService } from '../../core/services/i18n.service';

const ready = { enabled: true, available: true, edited: false, token: 'session-a', sidecar: null };

describe('darktable edit return controls', () => {
  let http: HttpTestingController;
  let close: ReturnType<typeof vi.fn>;
  const identity = signal('alice');

  beforeEach(() => {
    close = vi.fn();
    identity.set('alice');
    TestBed.configureTestingModule({
      imports: [DarktableEditDialogComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: { path: '/photos/a.jpg' } },
        { provide: MatDialogRef, useValue: { close, disableClose: false } },
        { provide: AuthService, useValue: { identity, isEdition: () => true, token: 'auth-a' } },
        { provide: I18nService, useValue: { translations: () => ({}), t: (key: string) => key } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); TestBed.resetTestingModule(); });

  async function setup(edited = false) {
    const fixture = TestBed.createComponent(DarktableEditDialogComponent);
    fixture.detectChanges();
    http.expectOne('/api/photo/darktable?path=/photos/a.jpg').flush({ ...ready, edited });
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('opens the desktop editor, then applies exactly the current session', async () => {
    const fixture = await setup();
    const button = (key: string) => [...fixture.nativeElement.querySelectorAll('button')]
      .find((b: HTMLButtonElement) => b.textContent?.includes(key)) as HTMLButtonElement;
    button('darktable_edit.open').click();
    const open = http.expectOne('/api/photo/darktable/open');
    expect(open.request.method).toBe('POST');
    expect(open.request.body).toEqual({ path: '/photos/a.jpg', token: 'session-a' });
    open.flush({ ...ready, token: 'session-b' });
    await fixture.whenStable();
    fixture.detectChanges();
    button('darktable_edit.apply').click();
    const apply = http.expectOne('/api/photo/darktable/apply');
    expect(apply.request.body.token).toBe('session-b');
    apply.flush({ ...ready, edited: true, token: 'session-c' });
    await fixture.whenStable();
    expect(close).toHaveBeenCalledWith('apply');
  });

  it('never applies by itself: a settled darktable save only prompts, Apply does the work', async () => {
    vi.useFakeTimers();
    try {
      const fixture = await setup();
      void fixture.componentInstance.run('open');
      http.expectOne('/api/photo/darktable/open').flush({ ...ready, sidecar: 'old' });
      await vi.advanceTimersByTimeAsync(0);
      const tick = async (sidecar: string) => {
        await vi.advanceTimersByTimeAsync(2000);
        http.expectOne('/api/photo/darktable?path=/photos/a.jpg').flush({ ...ready, token: 't-' + sidecar, sidecar });
        await vi.advanceTimersByTimeAsync(0);
      };
      await tick('old');
      await tick('new');
      await tick('new');
      await vi.advanceTimersByTimeAsync(10000);
      http.expectNone('/api/photo/darktable/apply');
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('darktable_edit.saved');
      expect(close).not.toHaveBeenCalled();
      ([...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[])
        .find((b) => b.textContent?.includes('darktable_edit.apply'))!.click();
      const apply = http.expectOne('/api/photo/darktable/apply');
      expect(apply.request.body.token).toBe('t-new');
      apply.flush({ ...ready, edited: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(close).toHaveBeenCalledWith('apply');
    } finally { vi.useRealTimers(); }
  });

  it('ignores the sidecar darktable creates on import', async () => {
    vi.useFakeTimers();
    try {
      const fixture = await setup();
      void fixture.componentInstance.run('open');
      http.expectOne('/api/photo/darktable/open').flush({ ...ready, sidecar: null });
      await vi.advanceTimersByTimeAsync(0);
      const tick = async (sidecar: string) => {
        await vi.advanceTimersByTimeAsync(2000);
        http.expectOne('/api/photo/darktable?path=/photos/a.jpg').flush({ ...ready, token: 't-' + sidecar, sidecar });
        await vi.advanceTimersByTimeAsync(0);
      };
      await tick('created');
      await tick('created');
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('darktable_edit.saved');
      await tick('edit');
      await tick('edit');
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('darktable_edit.saved');
      http.expectNone('/api/photo/darktable/apply');
    } finally { vi.useRealTimers(); }
  });

  it('says it is waiting for darktable while it watches, and not before a state is known', async () => {
    const fixture = await setup();
    const status = () => (fixture.nativeElement as HTMLElement).querySelector('[role="status"]');
    expect(status()?.textContent).toContain('darktable_edit.watching');
    fixture.destroy();
  });

  it('reload after a failed apply performs only a read and enables an explicit retry', async () => {
    const fixture = await setup();
    const pending = fixture.componentInstance.run('apply');
    http.expectOne('/api/photo/darktable/apply').flush({}, { status: 409, statusText: 'Conflict' });
    await pending;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('darktable_edit.failed_apply');
    const reload = [...fixture.nativeElement.querySelectorAll('button')]
      .find((b: HTMLButtonElement) => b.textContent?.includes('darktable_edit.reload')) as HTMLButtonElement;
    reload.click();
    http.expectOne('/api/photo/darktable?path=/photos/a.jpg').flush({ ...ready, token: 'fresh' });
    await fixture.whenStable();
    http.expectNone('/api/photo/darktable/apply');
    expect(close).not.toHaveBeenCalled();
    const retry = fixture.componentInstance.run('apply');
    const request = http.expectOne('/api/photo/darktable/apply');
    expect(request.request.body.token).toBe('fresh');
    request.flush({ ...ready, edited: true });
    await retry;
    expect(close).toHaveBeenCalledWith('apply');
  });

  it('ignores a successful completion after the account changes', async () => {
    const fixture = await setup(true);
    const pending = fixture.componentInstance.run('revert');
    identity.set('bob');
    http.expectOne('/api/photo/darktable/revert').flush(ready);
    await pending;
    expect(close).not.toHaveBeenCalled();
    expect(fixture.componentInstance.state()?.edited).toBe(true);
  });
});
