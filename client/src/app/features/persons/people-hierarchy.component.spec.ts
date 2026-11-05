import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import { PeopleHierarchyComponent } from './people-hierarchy.component';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { I18nService } from '../../core/services/i18n.service';

const parent = { id: 'parent', source_id: 1, target_id: 2, type_id: 'parent', other_name: 'Alice', forward_label: 'Parent of', reverse_label: 'Child of' };
const sibling = { id: 'sibling', source_id: 2, target_id: 3, type_id: 'sibling', other_name: 'Cleo', forward_label: 'Sibling of', reverse_label: 'Sibling of' };

function setup() {
  const identity = signal('alice');
  const api = { get: vi.fn().mockImplementation((path: string) => of({ connections: path.endsWith('/2') ? [parent, sibling] : [parent] })) };
  TestBed.configureTestingModule({ imports: [PeopleHierarchyComponent], providers: [
    { provide: ApiService, useValue: api }, { provide: AuthService, useValue: { identity } },
    { provide: I18nService, useValue: { translations: signal({}), t: (key: string) => ({ 'people_graph.all_people': 'All people', 'people_graph.parent': 'Parent of', 'people_graph.child': 'Child of', 'people_graph.sibling': 'Sibling of' }[key] || key) } },
  ] });
  const fixture = TestBed.createComponent(PeopleHierarchyComponent);
  fixture.componentRef.setInput('people', [{ id: 1, name: 'Alice' }, { id: 2, name: 'Ben' }, { id: 3, name: 'Cleo' }]);
  fixture.componentRef.setInput('groups', [{ id: 'family', name: 'Family', parent_id: null }, { id: 'children', name: 'Children', parent_id: 'family' }, { id: 'friends', name: 'Friends', parent_id: null }]);
  fixture.componentRef.setInput('members', [{ group_id: 'family', person_id: 1 }, { group_id: 'children', person_id: 2 }, { group_id: 'friends', person_id: 2 }]);
  fixture.detectChanges();
  const component = fixture.componentInstance;
  const toggle = (key: string) => { const row = component.rows().find(row => row.key === key); expect(row).toBeDefined(); component.toggle(row!); fixture.detectChanges(); };
  return { fixture, component, api, identity, toggle };
}

describe('PeopleHierarchyComponent', () => {
  it('starts collapsed and does not fetch person internals', () => {
    const { component, api } = setup();
    expect(component.rows().map(row => row.name)).toEqual(['Family', 'Friends', 'All people']);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('expands nested groups and overlapping memberships without duplicating identities', () => {
    const { component, toggle, api } = setup();
    toggle('g/family'); toggle('g/family/children'); toggle('g/friends');
    const ben = component.rows().filter(row => row.person?.id === 2);
    expect(ben).toHaveLength(2);
    expect(ben.every(row => !row.expanded)).toBe(true);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('loads connections on expansion, labels direction and terminates cycles', async () => {
    const { component, fixture, toggle, api } = setup();
    toggle('g/family'); toggle('g/family/children'); toggle('g/family/children/p2');
    await fixture.whenStable(); fixture.detectChanges();
    expect(api.get).toHaveBeenCalledWith('/people-graph/connections/2');
    expect(component.rows().find(row => row.key === 'g/family/children/p2/parent')?.relation).toBe('Parent of Ben');
    toggle('g/family/children/p2/parent');
    await fixture.whenStable(); fixture.detectChanges();
    const reference = component.rows().find(row => row.key === 'g/family/children/p2/parent/parent');
    expect(reference?.person?.id).toBe(2);
    expect(reference?.expandable).toBe(false);
    expect(api.get.mock.calls.every(([path]) => !String(path).includes('/notes/'))).toBe(true);
  });

  it('offers retry after failed expansion', async () => {
    const { component, fixture, toggle, api } = setup();
    api.get.mockReturnValueOnce(throwError(() => new Error('offline')));
    toggle('all'); toggle('all/p1');
    await fixture.whenStable(); fixture.detectChanges();
    const failed = component.rows().find(row => row.kind === 'error');
    expect(failed).toBeDefined();
    component.retry(failed!);
    await fixture.whenStable(); fixture.detectChanges();
    expect(component.rows().some(row => row.kind === 'error')).toBe(false);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('discards pending expansion data after identity changes', async () => {
    const { component, fixture, toggle, api, identity } = setup();
    const old = new Subject<{ connections: typeof parent[] }>();
    api.get.mockReturnValueOnce(old);
    toggle('all'); toggle('all/p2');
    identity.set('bob'); fixture.detectChanges();
    old.next({ connections: [parent] });
    await fixture.whenStable(); fixture.detectChanges();
    expect(component.rows().map(row => row.name)).toEqual(['Family', 'Friends', 'All people']);
    expect(component.rows().some(row => row.person)).toBe(false);
  });
  it('refreshes expanded connections after a relationship edit', async () => {
    const { component, fixture, toggle, api } = setup();
    toggle('all'); toggle('all/p2');
    await fixture.whenStable(); fixture.detectChanges();
    expect(component.rows().some(row => row.key === 'all/p2/parent')).toBe(true);
    api.get.mockReturnValue(of({ connections: [sibling] }));
    fixture.componentRef.setInput('connectionRevision', 1);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(component.rows().some(row => row.key === 'all/p2/parent')).toBe(false);
    expect(component.rows().some(row => row.key === 'all/p2/sibling')).toBe(true);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('keeps memberships visible in deeply nested groups', () => {
    const { fixture, component, toggle } = setup();
    const groups = Array.from({ length: 18 }, (_, index) => ({ id: 'level' + index, name: 'Level ' + index, parent_id: index ? 'level' + (index - 1) : null }));
    fixture.componentRef.setInput('groups', groups);
    fixture.componentRef.setInput('members', [{ group_id: 'level17', person_id: 2 }]);
    fixture.detectChanges();
    let key = 'g/level0';
    for (let index = 0; index < 18; index++) { toggle(key); key += '/level' + (index + 1); }
    expect(component.rows().find(row => row.person?.id === 2)?.depth).toBe(18);
  });

  it('allows search results to collapse and reopen', () => {
    const { fixture, component, toggle } = setup();
    fixture.componentRef.setInput('search', 'Ben'); fixture.detectChanges();
    expect(component.rows().some(row => row.person?.id === 2)).toBe(true);
    component.collapse(); fixture.detectChanges();
    expect(component.rows()).toHaveLength(1);
    expect(component.rows()[0].expanded).toBe(false);
    toggle('all');
    expect(component.rows().some(row => row.person?.id === 2)).toBe(true);
  });

});
