import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { I18nService } from '../../core/services/i18n.service';
import { i18nKeys } from '../../core/i18n/keys';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { PersonThumbnailUrlPipe } from '../../shared/pipes/thumbnail-url.pipe';

interface Person { id: number; name: string | null; face_thumbnail?: boolean; }
interface Group { id: string; name: string; parent_id: string | null; }
interface Member { group_id: string; person_id: number; }
interface Edge { id: string; source_id: number; target_id: number; type_id: string; other_name: string | null; forward_label: string; reverse_label: string; }
interface Row { key: string; kind: 'group' | 'person' | 'loading' | 'error' | 'empty'; name: string; depth: number; expanded: boolean; expandable: boolean; person?: Person; relation?: string; }

@Component({
  selector: 'app-people-hierarchy',
  imports: [MatIconModule, TranslatePipe, PersonThumbnailUrlPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <div class="mx-auto max-w-4xl">
      <div class="mb-8 flex items-start justify-between gap-4"><div><h2 class="text-2xl font-medium tracking-tight">{{ I18N.people_graph.hierarchy | translate }}</h2><p class="mt-2 max-w-xl text-sm text-[var(--mat-sys-on-surface-variant)]">{{ I18N.people_graph.hierarchy_hint | translate }}</p></div><button class="shrink-0 rounded-lg px-3 py-2 text-sm underline underline-offset-4 focus-visible:outline-2" (click)="collapse()">{{ I18N.people_graph.collapse_all | translate }}</button></div>
      <ul class="m-0 list-none p-0" [attr.aria-label]="I18N.people_graph.hierarchy | translate">
        @for (row of rows(); track row.key) {
          <li class="relative border-b border-[var(--mat-sys-outline-variant)]/50 " [class.motion-safe:animate-notice-in]="animateExpansion()" [style.padding-inline-start]="'min(' + row.depth * 1.5 + 'rem, 20vw)'" [attr.data-hierarchy-row]="row.key">
            @if (row.depth) { <span aria-hidden="true" class="pointer-events-none absolute bottom-0 top-0 w-px bg-[var(--mat-sys-outline-variant)]" [style.inset-inline-start]="'max(0rem, calc(min(' + row.depth * 1.5 + 'rem, 20vw) - 0.7rem))'"></span> }
            @if (row.kind === 'loading') { <p role="status" class="px-4 py-4 text-sm opacity-60">{{ I18N.ui.labels.loading | translate }}</p> }
            @else if (row.kind === 'empty') { <p class="px-4 py-4 text-sm text-[var(--mat-sys-on-surface-variant)]">{{ row.name }}</p> }
            @else if (row.kind === 'error') { <button class="min-h-12 rounded-lg px-4 text-sm underline focus-visible:outline-2" (click)="retry(row)">{{ I18N.people_graph.retry | translate }}</button> }
            @else {
              <div class="group flex min-h-16 items-center gap-2 py-1">
                <button class="flex min-h-14 min-w-0 flex-1 items-center gap-4 rounded-xl px-3 text-left transition-colors hover:bg-[var(--mat-sys-surface-container)] active:bg-[var(--mat-sys-surface-container-high)] focus-visible:outline-2" [attr.aria-expanded]="row.expandable ? row.expanded : null" (click)="toggle(row, $event)">
                  <span aria-hidden="true" class="flex size-5 shrink-0 items-center justify-center text-[var(--mat-sys-on-surface-variant)] " [class.motion-safe:transition-transform]="animateExpansion()" [class.motion-safe:duration-200]="animateExpansion()" [class.rotate-90]="row.expanded">{{ row.expandable ? '›' : '↗' }}</span>
                  @if (row.kind === 'group') { <span aria-hidden="true" class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--mat-sys-primary-container)] text-[var(--mat-sys-on-primary-container)]"><mat-icon class="!size-5 !text-xl">folder_open</mat-icon></span> }
                  @else if (row.person?.face_thumbnail) { <img class="size-9 shrink-0 rounded-full object-cover" [src]="row.person!.id | personThumbnailUrl" alt="" /> }
                  @else { <span aria-hidden="true" class="size-3 shrink-0 rounded-full bg-[var(--mat-sys-primary)]"></span> }
                  <span class="min-w-0"><span class="block truncate font-medium">{{ row.name }}</span>@if (row.relation) { <span class="mt-0.5 block text-xs text-[var(--mat-sys-on-surface-variant)]">{{ row.relation }}</span> }</span>
                </button>
                @if (row.person) { <button class="min-h-11 shrink-0 rounded-lg px-3 text-xs text-[var(--mat-sys-on-surface-variant)] hover:text-[var(--mat-sys-on-surface)] focus-visible:outline-2" (click)="inspect.emit(row.person)">{{ I18N.people_graph.open_profile | translate }}</button> }
              </div>
            }
          </li>
        } @empty { <li class="py-12 text-center text-sm opacity-60">{{ I18N.people_graph.empty | translate }}</li> }
      </ul>
    </div>
  `,
})
export class PeopleHierarchyComponent {
  readonly I18N = i18nKeys();
  readonly people = input<Person[]>([]);
  readonly groups = input<Group[]>([]);
  readonly members = input<Member[]>([]);
  readonly search = input('');
  readonly connectionRevision = input(0);
  private readonly searchCollapsed = signal(false);
  readonly inspect = output<Person>();
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18nService);
  private alive = true;
  private generation = 0;
  readonly animateExpansion = signal(true);
  private readonly expanded = signal(new Set<string>());
  private readonly edges = signal(new Map<number, Edge[]>());
  private readonly pending = signal(new Set<number>());
  private readonly failed = signal(new Set<number>());
  readonly rows = computed(() => {
    const rows: Row[] = [];
    const expanded = this.expanded();
    const people = new Map(this.people().map(person => [person.id, person]));
    const groupsByParent = new Map<string | null, Group[]>();
    for (const group of [...this.groups()].sort((a, b) => a.name.localeCompare(b.name))) {
      const siblings = groupsByParent.get(group.parent_id) || [];
      siblings.push(group); groupsByParent.set(group.parent_id, siblings);
    }
    const membersByGroup = new Map<string, Member[]>();
    for (const member of this.members()) {
      const members = membersByGroup.get(member.group_id) || [];
      members.push(member); membersByGroup.set(member.group_id, members);
    }
    for (const members of membersByGroup.values()) members.sort((a, b) => (people.get(a.person_id)?.name || '').localeCompare(people.get(b.person_id)?.name || ''));
    const query = this.search().trim().toLocaleLowerCase();
    const personRows = (person: Person, key: string, depth: number, ancestors: Set<number>, relation?: string) => {
      if (rows.length >= 1000) return;
      const cycle = ancestors.has(person.id) || ancestors.size >= 12;
      const open = expanded.has(key) && !cycle;
      rows.push({ key, kind: 'person', name: person.name || this.i18n.t(this.I18N.people_graph.unnamed), depth, expanded: open, expandable: !cycle, person, relation });
      if (!open) return;
      if (this.pending().has(person.id)) rows.push({ key: key + '/loading', kind: 'loading', name: '', depth: depth + 1, expanded: false, expandable: false });
      if (this.failed().has(person.id)) rows.push({ key: key + '/error', kind: 'error', name: '', depth: depth + 1, expanded: false, expandable: false, person });
      if (this.edges().has(person.id) && !this.edges().get(person.id)?.length) rows.push({ key: key + '/empty', kind: 'empty', name: this.i18n.t(this.I18N.people_graph.empty_connections), depth: depth + 1, expanded: false, expandable: false });
      const path = new Set(ancestors).add(person.id);
      for (const edge of this.edges().get(person.id) || []) {
        const identity = edge.source_id === person.id ? edge.target_id : edge.source_id;
        const other = people.get(identity);
        if (!other) continue;
        const forward = edge.source_id === identity;
        const builtin: Record<string, string> = { parent: forward ? this.I18N.people_graph.parent : this.I18N.people_graph.child, friend: this.I18N.people_graph.friend, coworker: this.I18N.people_graph.coworker, sibling: this.I18N.people_graph.sibling, partner: this.I18N.people_graph.partner };
        const label = builtin[edge.type_id] ? this.i18n.t(builtin[edge.type_id]) : forward ? edge.forward_label : edge.reverse_label;
        personRows(other, key + '/' + edge.id, depth + 1, path, label + ' ' + (person.name || this.i18n.t(this.I18N.people_graph.unnamed)));
      }
    };
    const groupRows = (group: Group, key: string, depth: number, visited: Set<string>) => {
      if (visited.has(group.id) || rows.length >= 1000) return;
      const open = expanded.has(key);
      rows.push({ key, kind: 'group', name: group.name, depth, expanded: open, expandable: true });
      if (!open) return;
      const path = new Set(visited).add(group.id);
      const start = rows.length;
      for (const child of groupsByParent.get(group.id) || []) groupRows(child, key + '/' + child.id, depth + 1, path);
      for (const member of membersByGroup.get(group.id) || []) {
        const person = people.get(member.person_id);
        if (person) personRows(person, key + '/p' + person.id, depth + 1, new Set());
      }
      if (rows.length === start) rows.push({ key: key + '/empty', kind: 'empty', name: this.i18n.t(this.I18N.people_graph.empty), depth: depth + 1, expanded: false, expandable: false });
    };
    if (!query) for (const group of groupsByParent.get(null) || []) groupRows(group, 'g/' + group.id, 0, new Set());
    const allKey = 'all';
    const matching = this.people().filter(person => !query || (person.name || '').toLocaleLowerCase().includes(query)).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    rows.push({ key: allKey, kind: 'group', name: this.i18n.t(this.I18N.people_graph.all_people), depth: 0, expanded: query ? !this.searchCollapsed() : expanded.has(allKey), expandable: true });
    if ((query && !this.searchCollapsed()) || (!query && expanded.has(allKey))) for (const person of matching) personRows(person, 'all/p' + person.id, 1, new Set());
    if (rows.length >= 1000) rows.push({ key: 'limit', kind: 'empty', name: this.i18n.t(this.I18N.people_graph.refine_hierarchy), depth: 0, expanded: false, expandable: false });
    return rows;
  });

  constructor() {
    effect(() => { this.search(); this.searchCollapsed.set(false); });
    effect(() => { this.connectionRevision(); untracked(() => this.refreshConnections()); });
    effect(() => { this.auth.identity(); this.generation++; this.expanded.set(new Set()); this.edges.set(new Map()); this.pending.set(new Set()); this.failed.set(new Set()); });
    inject(DestroyRef).onDestroy(() => { this.alive = false; this.generation++; });
  }
  collapse(): void { this.expanded.set(new Set()); this.searchCollapsed.set(true); }
  private refreshConnections(): void {
    const open = [...new Set(this.rows().filter(row => row.kind === 'person' && row.expanded).map(row => row.person!.id))];
    this.generation++;
    this.edges.set(new Map()); this.pending.set(new Set()); this.failed.set(new Set());
    for (const person of open) void this.load(person);
  }
  toggle(row: Row, event?: MouseEvent): void {
    this.animateExpansion.set(event?.detail !== 0);
    if (row.key === 'all' && this.search().trim()) { this.searchCollapsed.set(row.expanded); return; }
    if (!row.expandable) { if (row.person) this.inspect.emit(row.person); return; }
    const next = new Set(this.expanded());
    if (next.has(row.key)) next.delete(row.key); else next.add(row.key);
    this.expanded.set(next);
    if (next.has(row.key) && row.person && !this.edges().has(row.person.id)) void this.load(row.person.id);
  }
  retry(row: Row): void { if (row.person) void this.load(row.person.id); }
  private async load(personId: number): Promise<void> {
    if (this.pending().has(personId)) return;
    const generation = this.generation;
    this.pending.update(values => new Set(values).add(personId));
    this.failed.update(values => { const next = new Set(values); next.delete(personId); return next; });
    try {
      const result = await firstValueFrom(this.api.get<{ connections: Edge[] }>(`/people-graph/connections/${personId}`));
      if (!this.alive || generation !== this.generation) return;
      this.edges.update(values => new Map(values).set(personId, result.connections));
    } catch { if (this.alive && generation === this.generation) this.failed.update(values => new Set(values).add(personId)); }
    finally { if (this.alive && generation === this.generation) this.pending.update(values => { const next = new Set(values); next.delete(personId); return next; }); }
  }
}
