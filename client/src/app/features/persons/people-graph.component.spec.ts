import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { PeopleGraphComponent } from './people-graph.component';
import { I18nService } from '../../core/services/i18n.service';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';

const alice = { id: 1, name: 'Alice' };
const ben = { id: 2, name: 'Ben' };

describe('PeopleGraphComponent', () => {
  function setup() {
    const api = { get: vi.fn().mockImplementation((path: string) => of(path.includes('/groups') ? { groups: [], members: [] } : path.includes('/notes/') ? { body: '' } : path.includes('/neighborhood/') ? { people: [], connections: [] } : path.includes('/connections/') ? { connections: [], types: [] } : { persons: [], total: 0 })), put: vi.fn().mockReturnValue(of({ success: true })), post: vi.fn().mockReturnValue(of({ id: 'edge' })), delete: vi.fn().mockReturnValue(of({ success: true })) };
    const auth = { identity: signal('alice'), isEdition: signal(true) };
    TestBed.configureTestingModule({ imports: [PeopleGraphComponent], providers: [provideHttpClient(), provideRouter([]),
      { provide: ApiService, useValue: api },
      { provide: I18nService, useValue: { translations: signal({}), t: (key: string) => key === 'people_graph.saved' ? 'Notes saved.' : key } },
      { provide: AuthService, useValue: auth },
    ] });
    const fixture = TestBed.createComponent(PeopleGraphComponent);
    return { fixture, component: fixture.componentInstance, api, auth };
  }

  it('ignores a previous profile response after selecting another person', async () => {
    const { component, api } = setup();
    const oldGraph = new Subject<unknown>();
    const oldNote = new Subject<unknown>();
    api.get.mockImplementation((path: string) => path.endsWith('/1') ? (path.includes('/notes/') ? oldNote : oldGraph) : of(path.includes('/notes/') ? { body: 'Ben note' } : { connections: [], types: [], people: [] }));
    component.detailsOpen.set(true);
    const pending = component.select(alice);
    await component.select(ben);
    oldGraph.next({ connections: [{ id: 'stale' }], types: [], people: [] });
    oldNote.next({ body: 'Alice private note' });
    await pending;
    expect(component.selected()?.id).toBe(2);
    expect(component.note).toBe('Ben note');
    expect(component.connections()).toEqual([]);
  });

  it('preserves note text after a failed save and permits retry', async () => {
    const { component, api } = setup();
    component.selected.set(alice);
    component.noteReady.set(true);
    component.note = 'Remember this';
    api.put.mockReturnValueOnce(throwError(() => new Error('offline')));
    await component.saveNote();
    expect(component.note).toBe('Remember this');
    expect(component.saving()).toBe(false);
    await component.saveNote();
    expect(api.put).toHaveBeenLastCalledWith('/people-graph/notes/1', { body: 'Remember this' });
    expect(component.notice()).toBe('Notes saved.');
  });
  it('retains unsaved notes while moving between profiles', async () => {
    const { component, api } = setup();
    api.get.mockImplementation((path: string) => of(path.includes('/notes/') ? { body: 'Saved note' } : { connections: [], types: [], people: [] }));
    component.detailsOpen.set(true);
    await component.select(alice);
    component.note = 'Unfinished memory';
    await component.select(ben);
    await component.select(alice);
    expect(component.note).toBe('Unfinished memory');
  });

  it('never writes an empty note when the profile has not loaded', async () => {
    const { component, api } = setup();
    component.selected.set(alice);
    await component.saveNote();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('clears identity-owned form state in the rendered lifecycle', async () => {
    const { fixture, component, auth } = setup();
    fixture.detectChanges();
    await fixture.whenStable();
    component.groupEdit = 'private-group';
    component.groupEditName = 'Private family name';
    component.groupEditParent = 'private-parent';
    component.forwardLabel = 'Private relation';
    component.reverseLabel = 'Private inverse';
    component.types.set([{ id: 'private-type', forward_label: 'Private type', reverse_label: 'Inverse', mutual: 0 }]);
    auth.identity.set('bob');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.groupEdit).toBe('');
    expect(component.groupEditName).toBe('');
    expect(component.groupEditParent).toBe('');
    expect(component.forwardLabel).toBe('');
    expect(component.reverseLabel).toBe('');
    expect(component.types()).toEqual([]);
    expect(fixture.nativeElement.textContent).not.toContain('Private family name');
  });

  it('ignores old reload failure while a newer reload is pending', async () => {
    const { component, api } = setup();
    const first = new Subject<unknown>();
    const second = new Subject<unknown>();
    api.get.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const previous = component.reload();
    const current = component.reload();
    first.error(new Error('old request failed'));
    await previous;
    expect(component.error()).toBe('');
    expect(component.loading()).toBe(true);
    second.next({ persons: [], total: 0 });
    await current;
    expect(component.loading()).toBe(false);
  });

  it('starts in collapsed hierarchy mode and opens profiles only on request', async () => {
    const { fixture, component } = setup();
    fixture.detectChanges();
    await fixture.whenStable();
    component.people.set([alice, ben]);
    component.selected.set(alice);
    fixture.detectChanges();
    expect(component.hierarchyView()).toBe(true);
    expect(fixture.nativeElement.querySelector('app-people-hierarchy')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('aside')).toBeNull();
    component.openProfile(alice);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('aside')).not.toBeNull();
  });

  it('does not fetch notes until the profile is explicitly opened', async () => {
    const { fixture, component, api } = setup();
    fixture.detectChanges();
    await fixture.whenStable();
    api.get.mockClear();
    await component.select(alice);
    expect(api.get).not.toHaveBeenCalled();
    expect(component.noteReady()).toBe(false);
    component.openProfile(alice);
    await fixture.whenStable();
    expect(api.get).toHaveBeenCalledWith('/people-graph/notes/1');
  });

  it('removes moving lights when paused or reduced motion is requested', async () => {
    const { fixture, component } = setup();
    fixture.detectChanges(); await fixture.whenStable();
    component.selected.set(alice);
    component.networkPeople.set([alice, ben]);
    component.networkConnections.set([{ id: 'edge', source_id: 1, target_id: 2, type_id: 'friend', other_name: 'Ben', forward_label: 'Friend of', reverse_label: 'Friend of', mutual: 1 }]);
    component.hierarchyView.set(false);
    component.reducedMotion.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('animateMotion')).toHaveLength(0);
    component.reducedMotion.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('animateMotion')).toHaveLength(1);
    component.motionEnabled.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('animateMotion')).toHaveLength(0);
  });

  it('loads graph internals only when graph view is requested', async () => {
    const { fixture, component, api } = setup();
    fixture.detectChanges(); await fixture.whenStable();
    component.selected.set(alice);
    api.get.mockClear();
    component.showGraph();
    await fixture.whenStable();
    expect(api.get).toHaveBeenCalledWith('/people-graph/neighborhood/1', { depth: 1 });
    expect(api.get.mock.calls.some(([path]) => String(path).includes('/notes/'))).toBe(false);
  });

  it('invalidates hierarchy connections after successful additions and removals', async () => {
    const { component } = setup();
    component.selected.set(alice); component.target = 2;
    await component.connect();
    expect(component.connectionRevision()).toBe(1);
    await component.disconnect({ id: 'edge', source_id: 1, target_id: 2, type_id: 'friend', other_name: 'Ben', forward_label: 'Friend of', reverse_label: 'Friend of', mutual: 1 });
    expect(component.connectionRevision()).toBe(2);
  });

  it('keeps dragged people and link endpoints through filters, fit and profile refresh', async () => {
    const { fixture, component, api } = setup();
    fixture.detectChanges(); await fixture.whenStable();
    api.get.mockImplementation((path: string) => of(path.includes('/neighborhood/') ? { people: [alice, ben], connections: [{ id: 'edge', source_id: 1, target_id: 2, type_id: 'friend' }] } : { connections: [], types: [], body: '' }));
    component.selected.set(alice); component.hierarchyView.set(false);
    await component.select(alice);
    component.movePerson({ id: 1, x: 250, y: 220 });
    component.movePerson({ id: 2, x: 650, y: 420 });
    expect(component.graphLines()[0].path).toContain('M 250 220');
    expect(component.graphLines()[0].path).toContain('650 420');
    component.relationshipFilter.set('friend'); component.fit();
    await component.select(alice);
    expect(component.selectedPoint()).toEqual({ id: 1, x: 250, y: 220 });
    expect(component.graphNodes()[0].x).toBe(650);
    component.resetLayout();
    expect(component.pinned().size).toBe(0);
    expect(component.selectedPoint().x).toBe(450);
  });

  it('clears session layout when the account changes', async () => {
    const { fixture, component, auth } = setup();
    fixture.detectChanges(); await fixture.whenStable();
    component.movePerson({ id: 1, x: 900, y: 900 });
    auth.identity.set('another-account');
    fixture.detectChanges(); await fixture.whenStable();
    expect(component.pinned().size).toBe(0);
  });

  it('saves the selected direction and retains input after a rejected family cycle', async () => {
    const { component, api } = setup();
    component.selected.set(alice); component.people.set([alice, ben]);
    component.target = 2; component.kind = 'parent'; component.reverseConnection = true;
    api.post.mockReturnValueOnce(throwError(() => ({ error: { detail: 'Parent connection would create an ancestry cycle' } })));
    await component.connect();
    expect(api.post).toHaveBeenCalledWith('/people-graph/connections', expect.objectContaining({ source_id: 2, target_id: 1, type_id: 'parent' }));
    expect(component.target).toBe(2);
    expect(component.error()).toBe('people_graph.ancestry_error');
    await component.connect();
    expect(component.connectionRevision()).toBe(1);
  });

  it('creates a person through the existing API, reloads and opens their profile', async () => {
    const { fixture, component, api } = setup();
    fixture.detectChanges(); await fixture.whenStable();
    api.post.mockReturnValueOnce(of(ben));
    api.get.mockImplementation((path: string) => of(path === '/persons' ? { persons: [alice, ben], total: 2 } : path.includes('/groups') ? { groups: [], members: [] } : path.includes('/notes/') ? { body: '' } : { connections: [], types: [], people: [] }));
    component.personName = '  Ben  ';
    await component.createPerson(); await fixture.whenStable();
    expect(api.post).toHaveBeenCalledWith('/persons', { name: 'Ben' });
    expect(component.selected()?.id).toBe(2);
    expect(component.detailsOpen()).toBe(true);
    expect(component.personName).toBe('');
  });

  it('retains failed person input and does not expose a stale create response after account change', async () => {
    const { fixture, component, api, auth } = setup();
    fixture.detectChanges(); await fixture.whenStable();
    component.personName = 'New person';
    api.post.mockReturnValueOnce(throwError(() => new Error('offline')));
    await component.createPerson();
    expect(component.personName).toBe('New person');
    expect(component.saving()).toBe(false);
    const response = new Subject<unknown>(); api.post.mockReturnValueOnce(response);
    const pending = component.createPerson();
    auth.identity.set('bob'); fixture.detectChanges(); await fixture.whenStable();
    response.next(ben); await pending;
    expect(component.selected()).toBeNull();
    expect(component.detailsOpen()).toBe(false);
    expect(component.personName).toBe('');
  });

  it('creates a nested group independently of the active browsing filter', async () => {
    const { component, api } = setup();
    component.groupName = 'Children'; component.groupParent = 'family'; component.activeGroup.set('friends');
    await component.createGroup();
    expect(api.post).toHaveBeenCalledWith('/people-graph/groups', { name: 'Children', parent_id: 'family' });
    expect(component.groupName).toBe('');
    expect(component.groupParent).toBe('');
  });

  it('makes creation available in an empty library and hides writes for read-only users', async () => {
    const { fixture, component, auth } = setup();
    fixture.detectChanges(); await fixture.whenStable();
    component.toggleCreation('person'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name=personName]')).not.toBeNull();
    auth.isEdition.set(false); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[aria-controls=people-create-panel]')).toBeNull();
  });

  it('finishes global group creation when the selected person changes during the POST', async () => {
    const { fixture, component, api } = setup();
    fixture.detectChanges(); await fixture.whenStable();
    const response = new Subject<unknown>(); api.post.mockReturnValueOnce(response);
    component.groupName = 'New Family'; component.creationMode.set('group');
    const pending = component.createGroup();
    await component.select(ben);
    api.get.mockReturnValueOnce(of({ groups: [{ id: 'new', name: 'New Family', parent_id: null, can_edit: true }], members: [] }));
    response.next({ id: 'new' }); await pending;
    expect(component.groups()[0].name).toBe('New Family');
    expect(component.creationMode()).toBeNull();
    expect(component.groupName).toBe('');
    expect(component.selected()?.id).toBe(2);
  });

  it('does not offer a second group POST when creation succeeded but refresh failed', async () => {
    const { component, api } = setup();
    component.groupName = 'New Family'; component.creationMode.set('group');
    api.get.mockReturnValueOnce(throwError(() => new Error('offline')));
    await component.createGroup();
    expect(component.creationMode()).toBeNull();
    expect(component.groupName).toBe('');
    expect(component.creationNotice()).toBe('people_graph.group_created');
    expect(component.error()).toBe('people_graph.load_error');
    await component.createGroup();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('reports creation success with refresh failure without suggesting a missing face', async () => {
    const { fixture, component, api } = setup();
    fixture.detectChanges(); await fixture.whenStable();
    component.personName = 'Ben'; component.creationMode.set('person');
    api.post.mockReturnValueOnce(of(ben)); api.get.mockReturnValueOnce(throwError(() => new Error('offline')));
    await component.createPerson();
    expect(component.creationMode()).toBeNull();
    expect(component.personName).toBe('');
    expect(component.creationNotice()).toBe('people_graph.person_created');
    expect(component.error()).toBe('people_graph.load_error');
    await component.createPerson(); expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('shows one focused inspector section while preserving the note draft', async () => {
    const { fixture, component } = setup();
    fixture.detectChanges(); await fixture.whenStable();
    component.openProfile(alice); await fixture.whenStable(); fixture.detectChanges();
    const panel = (name: string): HTMLElement => fixture.nativeElement.querySelector(`[data-inspector-panel="${name}"]`);
    expect(panel('connections').hidden).toBe(false);
    expect(panel('notes').hidden).toBe(true);
    expect(panel('groups').hidden).toBe(true);
    component.profileTab.set('notes'); component.note = 'Unfinished memory'; fixture.detectChanges();
    expect(panel('connections').hidden).toBe(true);
    expect(panel('notes').hidden).toBe(false);
    component.profileTab.set('groups'); fixture.detectChanges();
    expect(panel('groups').hidden).toBe(false);
    expect(component.note).toBe('Unfinished memory');
  });

  it('opens the connection composer from the global action without exposing all profile forms', async () => {
    const { fixture, component } = setup();
    fixture.detectChanges(); await fixture.whenStable();
    component.selected.set(alice); component.profileTab.set('notes');
    component.startConnection(); await fixture.whenStable(); fixture.detectChanges();
    expect(component.profileTab()).toBe('connections');
    expect(component.connectionEditor()).toBe(true);
    expect(fixture.nativeElement.querySelector('form select[name=kind]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-inspector-panel=notes]').hidden).toBe(true);
  });

});
