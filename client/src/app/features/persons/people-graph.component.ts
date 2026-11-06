import { CdkTrapFocus } from '@angular/cdk/a11y';
import { PeopleGraphInteractionDirective } from './people-graph-interaction.directive';
import { zoomIdentity } from 'd3-zoom';
import { PeopleHierarchyComponent } from './people-hierarchy.component';
import { organicPeopleLayout, ambientPeoplePoint, GraphPoint } from './people-graph-layout';
import { ChangeDetectionStrategy, Component, NgZone, DestroyRef, ElementRef, viewChild, computed, effect, inject, signal, untracked } from '@angular/core';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { i18nKeys } from '../../core/i18n/keys';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { PersonThumbnailUrlPipe } from '../../shared/pipes/thumbnail-url.pipe';

interface GraphPerson { id: number; name: string | null; face_thumbnail?: boolean; }
interface Connection { id: string; source_id: number; target_id: number; type_id: string; other_name: string | null; forward_label: string; reverse_label: string; mutual: number; starts_on?: string | null; ends_on?: string | null; }
interface PeopleGroup { id: string; name: string; parent_id: string | null; can_edit: boolean; }
interface GroupMember { group_id: string; person_id: number; }
interface ConnectionType { id: string; forward_label: string; reverse_label: string; mutual: number; }

@Component({
  selector: 'app-people-graph',
  imports: [CdkTrapFocus, PeopleGraphInteractionDirective, PeopleHierarchyComponent, TranslatePipe, FormsModule, RouterLink, PersonThumbnailUrlPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full min-h-0' },
  template: `
    <main class="flex h-full min-h-0 flex-col overflow-auto lg:overflow-hidden bg-[var(--mat-sys-surface)] text-[var(--mat-sys-on-surface)]">
      <header class="relative z-20 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--mat-sys-outline-variant)] bg-[var(--mat-sys-surface)] px-5 py-3">
        <div class="flex items-center gap-4"><a routerLink="/persons" class="rounded-lg px-2 py-2 text-sm text-[var(--mat-sys-on-surface-variant)] focus-visible:outline-2">{{ I18N.people_graph.people | translate }}</a><h1 class="text-xl font-medium">{{ I18N.people_graph.title | translate }}</h1></div>
              <div class="order-last inline-flex rounded-lg bg-[var(--mat-sys-surface-container)] p-1 lg:order-none" [attr.aria-label]="I18N.people_graph.view_mode | translate">
                <button class="min-h-11 min-w-11 rounded-lg px-4 py-1.5 text-sm transition-colors focus-visible:outline-2" [class.bg-[var(--mat-sys-surface-container-highest)]]="hierarchyView()" [attr.aria-pressed]="hierarchyView()" (click)="showHierarchy()">{{ I18N.people_graph.hierarchy | translate }}</button>
                <button class="min-h-11 min-w-11 rounded-lg px-4 py-1.5 text-sm transition-colors focus-visible:outline-2" [class.bg-[var(--mat-sys-surface-container-highest)]]="!hierarchyView()" [attr.aria-pressed]="!hierarchyView()" (click)="showGraph()">{{ I18N.people_graph.graph_view | translate }}</button>
              </div>
        @if (auth.isEdition()) { <details class="relative text-sm"><summary class="flex size-11 cursor-pointer list-none items-center justify-center rounded-full border border-[var(--mat-sys-outline-variant)] text-[var(--mat-sys-on-surface-variant)] focus-visible:outline-2" [attr.aria-label]="I18N.people_graph.build_title | translate">?</summary><div class="absolute left-0 top-full z-50 mt-3 w-72 rounded-xl border border-[var(--mat-sys-outline-variant)] bg-[var(--mat-sys-surface-container)] p-2 shadow-2xl">
          <ol class="mx-5 mb-3 mt-3 list-decimal space-y-2 pl-4 text-[var(--mat-sys-on-surface-variant)]"><li>{{ I18N.people_graph.guide_people | translate }}</li><li>{{ I18N.people_graph.guide_connections | translate }}</li><li>{{ I18N.people_graph.guide_groups | translate }}</li></ol>
          <a routerLink="/persons" [queryParams]="{ tab: 'unassigned' }" class="mx-5 mb-3 inline-block rounded py-2 underline underline-offset-4 focus-visible:outline-2">{{ I18N.people_graph.assign_faces | translate }}</a>
        </div></details> }
        @if (auth.isEdition()) { <details #creationMenu [open]="wideScreen()" class="relative ml-auto"><summary class="flex size-11 cursor-pointer list-none items-center justify-center rounded-lg bg-[var(--mat-sys-primary)] text-2xl text-[var(--mat-sys-on-primary)] focus-visible:outline-2 lg:hidden" [attr.aria-label]="I18N.people_graph.create_menu | translate">+</summary><div class="absolute right-0 top-full z-50 mt-3 flex w-56 flex-col gap-2 rounded-xl border border-[var(--mat-sys-outline-variant)] bg-[var(--mat-sys-surface-container)] p-3 shadow-2xl lg:static lg:mt-0 lg:w-auto lg:flex-row lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
            <button class="min-h-11 min-w-11 rounded-lg border px-4 py-2 text-sm focus-visible:outline-2" [attr.aria-expanded]="creationMode() === 'person'" aria-controls="people-create-panel" (click)="toggleCreation('person')">{{ I18N.people_graph.new_person | translate }}</button>
            <button class="min-h-11 min-w-11 rounded-lg border px-4 py-2 text-sm focus-visible:outline-2" [attr.aria-expanded]="creationMode() === 'group'" aria-controls="people-create-panel" (click)="toggleCreation('group')">{{ I18N.people_graph.new_group | translate }}</button>
            <button class="min-h-11 min-w-11 rounded-lg bg-[var(--mat-sys-primary)] px-4 py-2 text-sm text-[var(--mat-sys-on-primary)] disabled:cursor-not-allowed disabled:bg-[var(--mat-sys-surface-container)] disabled:text-[var(--mat-sys-on-surface-variant)] focus-visible:outline-2" [disabled]="!selected()" (click)="startConnection()">{{ I18N.people_graph.add_connection | translate }}</button></div></details> }
      </header>
      @if (error()) { <div role="alert" class="flex items-center justify-between gap-4 border-b px-6 py-3"><span>{{ error() }}</span><button class="min-h-11 min-w-11 rounded-lg border px-3 py-2 focus-visible:outline-2" (click)="reload()">{{ I18N.people_graph.retry | translate }}</button></div> }
      <section class="relative z-30" [attr.aria-label]="I18N.people_graph.build_title | translate">

        @if (auth.isEdition() && creationMode(); as mode) {
          <div id="people-create-panel" tabindex="-1" (keydown.escape)="closeCreation(); $event.stopPropagation()" class="absolute inset-x-4 top-16 z-40 mx-auto max-w-xl rounded-2xl border border-[var(--mat-sys-outline-variant)] bg-[var(--mat-sys-surface-container)] p-6 shadow-2xl">
            @if (mode === 'person') {
              <form class="space-y-3" (ngSubmit)="createPerson()"><label class="block text-sm">{{ I18N.people_graph.person_name | translate }}<input #creationInput name="personName" required maxlength="200" [(ngModel)]="personName" class="mt-1 block w-full rounded-lg border bg-transparent p-3 focus-visible:outline-2" /></label><p class="text-sm opacity-70">{{ I18N.people_graph.person_help | translate }}</p><div class="flex gap-3"><button [disabled]="saving() || !personName" class="min-h-11 min-w-11 rounded-lg bg-[var(--mat-sys-primary)] px-4 py-2 text-[var(--mat-sys-on-primary)] disabled:cursor-not-allowed disabled:bg-[var(--mat-sys-surface-container)] disabled:text-[var(--mat-sys-on-surface-variant)] focus-visible:outline-2">{{ I18N.people_graph.create_person | translate }}</button><button type="button" (click)="closeCreation()" class="rounded-lg border px-4 py-2 focus-visible:outline-2">{{ I18N.people_graph.cancel | translate }}</button></div></form>
            } @else {
              <form class="space-y-3" (ngSubmit)="createGroup()"><label class="block text-sm">{{ I18N.people_graph.group_name | translate }}<input #creationInput name="groupName" required maxlength="100" [(ngModel)]="groupName" class="mt-1 block w-full rounded-lg border bg-transparent p-3 focus-visible:outline-2" /></label>
                <label class="block text-sm">{{ I18N.people_graph.parent_group | translate }}<select name="groupParent" [(ngModel)]="groupParent" class="mt-1 block w-full rounded-lg border bg-[var(--mat-sys-surface)] p-3 focus-visible:outline-2"><option value="">{{ I18N.people_graph.no_parent | translate }}</option>@for (group of editableGroupLabels(); track group.id) { <option [value]="group.id">{{ group.label }}</option> }</select></label>
                <p class="text-sm opacity-70">{{ I18N.people_graph.group_help | translate }}</p><div class="flex gap-3"><button [disabled]="saving() || !groupName" class="min-h-11 min-w-11 rounded-lg bg-[var(--mat-sys-primary)] px-4 py-2 text-[var(--mat-sys-on-primary)] disabled:cursor-not-allowed disabled:bg-[var(--mat-sys-surface-container)] disabled:text-[var(--mat-sys-on-surface-variant)] focus-visible:outline-2">{{ I18N.people_graph.create_group | translate }}</button><button type="button" (click)="closeCreation()" class="rounded-lg border px-4 py-2 focus-visible:outline-2">{{ I18N.people_graph.cancel | translate }}</button></div>
              </form>
            }
          </div>
        }
        @if (creationNotice()) { <p role="status" class="absolute left-5 top-3 z-30 max-w-sm rounded-lg bg-[var(--mat-sys-surface-container)] px-3 py-2 text-sm shadow-lg">{{ creationNotice() }}</p> }
      </section>
      <div class="grid min-h-0 flex-1 grid-cols-1 " [class.lg:grid-cols-1]="hierarchyView() && !detailsOpen()" [class.lg:grid-cols-[minmax(0,1fr)_19rem]]="hierarchyView() && detailsOpen()" [class.lg:grid-cols-[13.5rem_minmax(0,1fr)]]="!hierarchyView() && !detailsOpen()" [class.lg:grid-cols-[13.5rem_minmax(0,1fr)_19rem]]="!hierarchyView() && detailsOpen()">
        @if (!hierarchyView()) {
        <nav [attr.aria-label]="I18N.people_graph.people | translate" class="hidden min-h-0 overflow-auto border-r border-[var(--mat-sys-outline-variant)] bg-[var(--mat-sys-surface-container-low)] px-3 py-5 lg:block">
        <label class="mb-5 block text-xs text-[var(--mat-sys-on-surface-variant)]">{{ I18N.people_graph.find | translate }}<input [attr.aria-label]="I18N.people_graph.find | translate" class="mt-2 block w-full min-w-0 rounded-lg border border-[var(--mat-sys-outline)] bg-transparent px-3 py-2.5 text-sm focus-visible:outline-2" [ngModel]="search()" (ngModelChange)="search.set($event)" /></label>
          <details class="mb-4"><summary class="cursor-pointer rounded-lg py-2 text-sm focus-visible:outline-2" (click)="loadTags()">{{ I18N.people_graph.tags | translate }}</summary><ul class="mt-2 space-y-2">@for (tag of tags(); track tag.id) { <li><a class="block rounded-lg px-2 py-1 text-sm hover:bg-[var(--mat-sys-surface-container)] focus-visible:outline-2" routerLink="/" [queryParams]="{ keyword_branch: tag.id }">{{ tag.label }}</a></li> }</ul></details>
          <div class="mb-4 pb-2">
            <label class="block text-sm">{{ I18N.people_graph.group | translate }}<select class="mt-2 w-full rounded-lg border bg-[var(--mat-sys-surface)] p-2 focus-visible:outline-2" [ngModel]="activeGroup()" (ngModelChange)="activeGroup.set($event)"><option value="">{{ I18N.people_graph.all_people | translate }}</option>@for (group of groupLabels(); track group.id) { <option [value]="group.id">{{ group.label }}</option> }</select></label>
          </div>
          @if (loading()) { <p role="status" class="p-3 text-sm">{{ I18N.people_graph.loading | translate }}</p> }
          @for (person of filtered(); track person.id) {
            <button class="min-h-11 min-w-11 mb-1 flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-[var(--mat-sys-surface-container)] focus-visible:outline-2" [class.bg-[var(--mat-sys-surface-container-high)]]="selected()?.id === person.id" [attr.aria-current]="selected()?.id === person.id ? 'true' : null" (click)="select(person)">
              @if (person.face_thumbnail) { <img class="size-10 rounded-full object-cover" [src]="person.id | personThumbnailUrl" alt="" /> }
              <span class="truncate text-sm">{{ person.name || (I18N.people_graph.unnamed | translate) }}</span>
            </button>
          } @empty { @if (!loading()) { <p class="p-3 text-sm opacity-70">{{ I18N.people_graph.empty | translate }}</p> } }
        </nav>
        }
        <section [attr.aria-label]="I18N.people_graph.graph_view | translate" class="relative flex min-h-[34rem] min-w-0 flex-col overflow-auto lg:min-h-0" [class.bg-[var(--facet-image-canvas)]]="!hierarchyView()" [class.bg-[var(--mat-sys-surface)]]="hierarchyView()">
          @if (selected(); as person) {
            @if (!hierarchyView()) {
              <div class="flex shrink-0 flex-wrap items-center gap-4 border-b border-[var(--mat-sys-outline-variant)]/50 px-5 py-3 text-xs text-[var(--mat-sys-on-surface-variant)]"><label class="lg:hidden">{{ I18N.people_graph.person | translate }}<select class="ml-2 rounded-lg border border-[var(--mat-sys-outline)] bg-[var(--mat-sys-surface)] p-2 focus-visible:outline-2" [ngModel]="selected()?.id" (ngModelChange)="selectById($event)">@for (candidate of people(); track candidate.id) { <option [ngValue]="candidate.id">{{ candidate.name || (I18N.people_graph.unnamed | translate) }}</option> }</select></label><label class="lg:block" [class.hidden]="!filtersOpen()">{{ I18N.people_graph.relationship | translate }}<select class="ml-2 rounded-lg border border-[var(--mat-sys-outline)] bg-[var(--mat-sys-surface)] p-2 focus-visible:outline-2" [ngModel]="relationshipFilter()" (ngModelChange)="relationshipFilter.set($event)"><option value="">{{ I18N.people_graph.all_relationships | translate }}</option>@for (type of displayTypes(); track type.id) { <option [value]="type.id">{{ type.forward_label }}</option> }</select></label><label class="lg:block" [class.hidden]="!filtersOpen()">{{ I18N.people_graph.depth | translate }}<select class="ml-2 rounded-lg border border-[var(--mat-sys-outline)] bg-[var(--mat-sys-surface)] p-2 focus-visible:outline-2" [ngModel]="depth()" (ngModelChange)="changeDepth($event)"><option [ngValue]="1">1</option><option [ngValue]="2">2</option><option [ngValue]="3">3</option></select></label><button class="min-h-11 min-w-11 rounded-lg px-2 py-2 text-xs focus-visible:outline-2 lg:hidden" [attr.aria-expanded]="filtersOpen()" (click)="filtersOpen.set(!filtersOpen())">{{ I18N.people_graph.filters | translate }}</button><button class="min-h-11 min-w-11 ml-auto rounded-lg px-3 py-2 text-sm hover:bg-[var(--mat-sys-surface-container)] focus-visible:outline-2" [attr.aria-expanded]="detailsOpen()" (click)="toggleProfile()">{{ (detailsOpen() ? I18N.people_graph.close_profile : I18N.people_graph.open_profile) | translate }}</button></div>
            }
            @if (!hierarchyView()) {
              <div class="relative flex min-h-0 flex-1 flex-col text-[var(--facet-image-ink)]">
                <div [class.bottom-5]="wideScreen() || !detailsOpen()" [class.bottom-40]="!wideScreen() && detailsOpen()" class="absolute left-5 z-10 flex max-w-[calc(100%-2.5rem)] flex-wrap items-center gap-1 rounded-xl border border-[var(--mat-sys-outline-variant)]/60 bg-[var(--mat-sys-surface)]/95 p-1.5 shadow-lg"><button class="min-h-11 min-w-11 rounded-lg px-3 py-2 text-sm hover:bg-[var(--mat-sys-surface-container)] focus-visible:outline-2" [attr.aria-label]="I18N.people_graph.zoom_in | translate" (click)="zoomBy(1.25)">+</button><button class="min-h-11 min-w-11 rounded-lg px-3 py-2 text-sm hover:bg-[var(--mat-sys-surface-container)] focus-visible:outline-2" [attr.aria-label]="I18N.people_graph.zoom_out | translate" (click)="zoomBy(0.8)">−</button><button class="min-h-11 min-w-11 rounded-lg px-3 py-2 text-sm hover:bg-[var(--mat-sys-surface-container)] focus-visible:outline-2" (click)="fit()">{{ I18N.people_graph.fit | translate }}</button><button class="min-h-11 min-w-11 hidden sm:block rounded-lg px-3 py-2 text-sm hover:bg-[var(--mat-sys-surface-container)] focus-visible:outline-2" (click)="resetLayout()">{{ I18N.people_graph.reset_layout | translate }}</button><button class="min-h-11 min-w-11 hidden sm:block rounded-lg border-l border-[var(--mat-sys-outline-variant)] px-3 py-2 text-xs focus-visible:outline-2" [attr.aria-pressed]="motionEnabled()" (click)="motionEnabled.set(!motionEnabled())">{{ (motionEnabled() ? I18N.people_graph.pause_motion : I18N.people_graph.resume_motion) | translate }}</button><details class="relative sm:hidden"><summary class="flex size-11 cursor-pointer list-none items-center justify-center rounded-lg text-lg focus-visible:outline-2" [attr.aria-label]="I18N.people_graph.more_controls | translate">…</summary><div class="absolute bottom-full left-0 mb-3 flex w-44 flex-col rounded-xl border border-[var(--mat-sys-outline-variant)] bg-[var(--mat-sys-surface)] p-2 shadow-lg"><button class="min-h-11 min-w-11 rounded-lg px-3 py-2 text-sm hover:bg-[var(--mat-sys-surface-container)] focus-visible:outline-2" (click)="resetLayout()">{{ I18N.people_graph.reset_layout | translate }}</button><button class="min-h-11 min-w-11 rounded-lg border-l border-[var(--mat-sys-outline-variant)] px-3 py-2 text-xs focus-visible:outline-2" [attr.aria-pressed]="motionEnabled()" (click)="motionEnabled.set(!motionEnabled())">{{ (motionEnabled() ? I18N.people_graph.pause_motion : I18N.people_graph.resume_motion) | translate }}</button></div></details></div>
                <div class="pointer-events-none absolute bottom-8 right-5 top-5 z-10 hidden h-fit gap-4 text-xs text-[var(--facet-image-ink)]/70 md:flex"><span class="flex items-center gap-2"><span class="w-5 border-t" style="border-color:var(--facet-graph-family)"></span>{{ I18N.people_graph.family_links | translate }}</span><span class="flex items-center gap-2"><span class="w-5 border-t" style="border-color:var(--facet-graph-social)"></span>{{ I18N.people_graph.social_links | translate }}</span></div>
                <svg [attr.viewBox]="viewBox()" appPeopleGraphInteraction [position]="positionForDrag" [initialCamera]="camera()" (cameraChanged)="camera.set($event)" (viewportChanged)="viewport.set($event)" (started)="beginInteraction()" (finished)="interacting.set(false)" (pointerenter)="hovering.set(true)" (pointerleave)="hovering.set(false)" (moved)="movePerson($event)" class="h-full min-h-[30rem] w-full flex-1 touch-none lg:min-h-0" [attr.aria-label]="I18N.people_graph.title | translate" role="group">
                  <defs>
                    <filter id="people-link-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
                    <radialGradient id="people-ambient"><stop offset="0" stop-color="var(--facet-graph-family)" stop-opacity="0.09" /><stop offset="1" stop-color="var(--facet-graph-family)" stop-opacity="0" /></radialGradient>
                  </defs>
                  <g data-graph-world>
                  <ellipse cx="450" cy="350" rx="480" ry="380" fill="url(#people-ambient)" pointer-events="none" />
                  @for (line of graphLines(); track line.id) {
                    <path [attr.d]="line.path" fill="none" [attr.stroke]="line.color" stroke-width="5" opacity="0.12" filter="url(#people-link-glow)" />
                    <path [attr.d]="line.path" fill="none" [attr.stroke]="line.color" stroke-width="1.2" opacity="0.48" />
                    @if (motionEnabled() && !reducedMotion()) { <circle r="1.8" [attr.fill]="line.color" opacity="0.85"><animateMotion [attr.path]="line.path" dur="5s" repeatCount="indefinite" /></circle> }
                  }
                  @for (node of graphNodes(); track node.personId) {
                    <g [attr.data-graph-node]="node.personId" class="cursor-grab active:cursor-grabbing" [attr.transform]="'translate(' + node.x + ' ' + node.y + ')'">
                    <foreignObject x="-100" y="-80" width="200" height="170">
                      <button [attr.data-graph-person]="node.personId" [attr.aria-label]="(node.person.name || (I18N.people_graph.unnamed | translate)) + ' ' + node.label" [attr.title]="node.label" class="group flex h-full w-full flex-col items-center justify-center gap-2 rounded-2xl px-2 py-1 text-center text-[var(--facet-image-ink)] focus-visible:outline-2 focus-visible:-outline-offset-4" (click)="select(node.person)">
                        <span class="relative flex size-14 shrink-0 items-center justify-center rounded-full border bg-[var(--mat-sys-surface-container)] shadow-[0_0_28px_color-mix(in_srgb,var(--facet-graph-family)_22%,transparent)] motion-safe:transition-transform motion-safe:duration-200 motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover:scale-110 motion-safe:group-active:scale-95" [style.border-color]="node.color">
                          @if (node.portrait) { <img class="size-12 rounded-full object-cover" [src]="node.personId | personThumbnailUrl" alt="" /> }
                          @else { <span class="size-3 rounded-full" [style.background]="node.color"></span> }
                        </span>
                        <span [style.font-size.px]="labelSize()" [style.line-height.px]="labelSize() * 1.15" class="line-clamp-2 max-w-full rounded-md bg-[var(--facet-image-canvas)]/90 px-2 py-0.5 font-medium">{{ node.person.name || (I18N.people_graph.unnamed | translate) }}</span>
                        @if (node.directLabel) { <span [style.font-size.px]="labelSize() * 0.72" [style.line-height.px]="labelSize() * 0.86" class="line-clamp-1 max-w-full text-[var(--facet-image-ink)]/65">{{ node.directLabel }}</span> }


                      </button>
                    </foreignObject>
                    </g>
                  }
                  <g [attr.data-graph-node]="person.id" class="cursor-grab active:cursor-grabbing" [attr.transform]="'translate(' + selectedPoint().x + ' ' + selectedPoint().y + ')'"><foreignObject x="-100" y="-90" width="200" height="180">
                    <button class="min-h-11 min-w-11 group flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl text-center text-[var(--facet-image-ink)] focus-visible:outline-2" (click)="openProfile(person)">
                      <span class="flex size-20 items-center justify-center rounded-full border-2 border-[var(--facet-graph-family)] bg-[var(--mat-sys-surface-container)] shadow-[0_0_48px_color-mix(in_srgb,var(--facet-graph-family)_30%,transparent)]">
                        @if (person.face_thumbnail) { <img class="size-[4.5rem] rounded-full object-cover" [src]="person.id | personThumbnailUrl" alt="" /> }
                        @else { <span class="size-4 rounded-full bg-[var(--facet-graph-family)]"></span> }
                      </span>
                      <h2 [style.font-size.px]="labelSize() * 1.12" [style.line-height.px]="labelSize() * 1.3" class="line-clamp-2 max-w-full rounded-md bg-[var(--facet-image-canvas)]/90 px-2 py-1 font-medium">{{ person.name || (I18N.people_graph.unnamed | translate) }}</h2>
                    </button>
                  </foreignObject></g>
                  </g>
                </svg>
              </div>
            } @else {
              <app-people-hierarchy class="block overflow-auto bg-[var(--mat-sys-surface)] p-5 lg:p-8" [people]="people()" [groups]="groups()" [members]="members()" [search]="search()" [connectionRevision]="connectionRevision()" (inspect)="openProfile($event)" />
            }
          } @else { <p class="py-20 text-center opacity-70">{{ I18N.people_graph.choose | translate }}</p> }
        </section>
        @if (detailsOpen()) {
        @if (!wideScreen() && sheetExpanded()) { <button tabindex="-1" class="fixed inset-0 z-30 bg-[var(--facet-image-canvas)]/60" [attr.aria-label]="I18N.people_graph.close_profile | translate" (click)="closeProfile()"></button> }
        @if (selected(); as person) {
          <aside tabindex="-1" [cdkTrapFocus]="!wideScreen() && sheetExpanded()" [cdkTrapFocusAutoCapture]="!wideScreen() && sheetExpanded()" [attr.role]="!wideScreen() && sheetExpanded() ? 'dialog' : null" [attr.aria-modal]="!wideScreen() && sheetExpanded() ? 'true' : null" (keydown.escape)="closeProfile(); $event.stopPropagation()" [attr.aria-label]="I18N.people_graph.person | translate" class="fixed inset-x-0 bottom-0 z-40 max-h-[75dvh] overflow-auto rounded-t-2xl border border-[var(--mat-sys-outline-variant)] bg-[var(--mat-sys-surface-container-low)] p-4 shadow-2xl lg:static lg:p-5 lg:max-h-none lg:rounded-none lg:border-y-0 lg:border-r-0 lg:shadow-none">
<div class="flex items-start gap-3">
              @if (person.face_thumbnail) { <img [src]="person.id | personThumbnailUrl" alt="" class="size-14 rounded-full object-cover" /> }
              <div class="min-w-0 flex-1"><h2 #profileHeading tabindex="-1" [class.line-clamp-2]="!wideScreen() && !sheetExpanded()" [attr.title]="person.name" class="break-words text-xl font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--mat-sys-primary)]">{{ person.name || (I18N.people_graph.unnamed | translate) }}</h2><a routerLink="/" [queryParams]="{ person_id: person.id }" class="mt-1 inline-block rounded py-1 text-xs text-[var(--mat-sys-primary)] focus-visible:outline-2">{{ I18N.people_graph.photos | translate }}</a></div>
              <button class="min-h-11 min-w-11 rounded-lg px-2 py-1 text-xl focus-visible:outline-2" [attr.aria-label]="I18N.people_graph.close_profile | translate" (click)="closeProfile()">×</button>
            </div>
            @if (!wideScreen()) { <button class="min-h-11 min-w-11 mt-2 w-full rounded-lg py-1 text-xs text-[var(--mat-sys-primary)] focus-visible:outline-2" [attr.aria-expanded]="sheetExpanded()" (click)="sheetExpanded.set(!sheetExpanded())">{{ (sheetExpanded() ? I18N.people_graph.collapse_details : I18N.people_graph.expand_details) | translate }}</button> }
            <div [hidden]="!wideScreen() && !sheetExpanded()">
            @if (auth.isEdition()) { <details class="relative mt-3 text-sm"><summary class="w-fit cursor-pointer rounded-lg py-2 text-[var(--mat-sys-on-surface-variant)] focus-visible:outline-2">{{ I18N.people_graph.person_actions | translate }}</summary><div class="mt-2 rounded-lg border border-[var(--mat-sys-outline-variant)] p-3">            @if (auth.isEdition()) { <details class="text-sm"><summary class="cursor-pointer rounded py-2 underline focus-visible:outline-2">{{ I18N.people_graph.rename_person | translate }}</summary><form class="mt-2 flex flex-col gap-2" (ngSubmit)="renamePerson()"><label>{{ I18N.people_graph.person_name | translate }}<input name="rename" required maxlength="200" class="mt-1 w-full rounded-lg border bg-transparent p-2 focus-visible:outline-2" [(ngModel)]="renameName" /></label><button class="min-h-11 min-w-11 rounded-lg border px-3 py-2 disabled:cursor-not-allowed disabled:bg-[var(--mat-sys-surface-container)] disabled:text-[var(--mat-sys-on-surface-variant)] focus-visible:outline-2" [disabled]="saving() || !renameName">{{ I18N.people_graph.rename_person | translate }}</button></form></details><a routerLink="/persons" [queryParams]="{ tab: 'unassigned' }" class="inline-block rounded py-2 text-sm underline focus-visible:outline-2">{{ I18N.people_graph.assign_faces | translate }}</a> }</div></details> }
            <div class="my-3 flex border-b border-[var(--mat-sys-outline-variant)]" role="group" [attr.aria-label]="I18N.people_graph.person | translate">
              <button class="min-h-11 min-w-11 flex-1 border-b-2 px-1 py-3 text-xs whitespace-nowrap focus-visible:outline-2" [class.border-[var(--mat-sys-primary)]]="profileTab() === 'connections'" [class.border-transparent]="profileTab() !== 'connections'" [attr.aria-pressed]="profileTab() === 'connections'" (click)="profileTab.set('connections')">{{ I18N.people_graph.title | translate }}</button>
              <button class="min-h-11 min-w-11 flex-1 border-b-2 px-1 py-3 text-xs whitespace-nowrap focus-visible:outline-2" [class.border-[var(--mat-sys-primary)]]="profileTab() === 'groups'" [class.border-transparent]="profileTab() !== 'groups'" [attr.aria-pressed]="profileTab() === 'groups'" (click)="profileTab.set('groups')">{{ I18N.people_graph.groups | translate }}</button>
              <button class="min-h-11 min-w-11 flex-1 border-b-2 px-1 py-3 text-xs whitespace-nowrap focus-visible:outline-2" [class.border-[var(--mat-sys-primary)]]="profileTab() === 'notes'" [class.border-transparent]="profileTab() !== 'notes'" [attr.aria-pressed]="profileTab() === 'notes'" (click)="profileTab.set('notes')">{{ I18N.people_graph.notes_tab | translate }}</button>
            </div>
            <div data-inspector-panel="notes" [hidden]="profileTab() !== 'notes'">

            <div class="mt-8"><label for="person-note" class="block font-medium">{{ I18N.people_graph.notes | translate }}</label><p id="note-help" class="mt-1 text-sm opacity-70">{{ I18N.people_graph.note_help | translate }}</p><textarea id="person-note" aria-describedby="note-help" class="mt-3 min-h-40 w-full rounded-xl border border-[var(--mat-sys-outline)] bg-transparent p-3 focus-visible:outline-2" maxlength="20000" [(ngModel)]="note" [readonly]="!auth.isEdition() || !noteReady()"></textarea>
            @if (auth.isEdition()) { <button class="min-h-11 min-w-11 mt-2 rounded-lg bg-[var(--mat-sys-primary)] px-4 py-2 text-[var(--mat-sys-on-primary)] disabled:cursor-not-allowed disabled:bg-[var(--mat-sys-surface-container)] disabled:text-[var(--mat-sys-on-surface-variant)] focus-visible:outline-2" [disabled]="saving() || !noteReady()" (click)="saveNote()">{{ I18N.people_graph.save_notes | translate }}</button> }</div>
            </div>
            <div data-inspector-panel="connections" [hidden]="profileTab() !== 'connections'">
              <ul class="space-y-2">@for (edge of displayConnections(); track edge.id) {
                <li class="flex items-center gap-2 rounded-lg border border-[var(--mat-sys-outline-variant)]/60 px-3 py-3"><button class="min-h-11 min-w-11 min-w-0 flex-1 text-left focus-visible:outline-2" (click)="follow(edge)"><span class="block truncate text-sm">{{ edge.other_name || (I18N.people_graph.unnamed | translate) }}</span><span class="mt-1 block text-xs text-[var(--mat-sys-on-surface-variant)]">{{ edge.source_id === person.id ? edge.reverse_label : edge.forward_label }} {{ person.name }}</span></button>@if (auth.isEdition()) { <button class="min-h-11 min-w-11 rounded px-2 py-1 text-lg opacity-60 hover:opacity-100 focus-visible:outline-2" [disabled]="saving()" [attr.aria-label]="(I18N.people_graph.remove | translate) + ' ' + edge.other_name" (click)="disconnect(edge)">×</button> }</li>
              } @empty { <li class="py-4 text-sm text-[var(--mat-sys-on-surface-variant)]">{{ I18N.people_graph.no_connections | translate }}</li> }</ul>
              @if (auth.isEdition()) { <button class="min-h-11 min-w-11 mt-4 w-full rounded-lg border border-dashed border-[var(--mat-sys-outline)] px-4 py-3 text-sm focus-visible:outline-2" [attr.aria-expanded]="connectionEditor()" (click)="connectionEditor.set(!connectionEditor())">{{ I18N.people_graph.add_connection | translate }}</button> }
            @if (auth.isEdition() && connectionEditor()) {
              <form class="mt-5 flex flex-col gap-3" (ngSubmit)="connect()"><h3 #connectionHeading tabindex="-1" class="font-medium focus-visible:outline-2">{{ I18N.people_graph.add_connection | translate }}</h3>
                <label class="text-sm">{{ I18N.people_graph.relationship | translate }}<select class="mt-1 w-full rounded-lg border bg-[var(--mat-sys-surface)] p-2 focus-visible:outline-2" name="kind" [ngModel]="kind" (ngModelChange)="kind = $event; reverseConnection = false; updateConnectionPreview()">@for (type of displayTypes(); track type.id) { <option [value]="type.id">{{ type.forward_label }}</option> }</select></label>
                <label class="text-sm">{{ I18N.people_graph.person | translate }}<select class="mt-1 w-full rounded-lg border bg-[var(--mat-sys-surface)] p-2 focus-visible:outline-2" name="target" [ngModel]="target" (ngModelChange)="target = $event; updateConnectionPreview()"> <option [ngValue]="null">{{ I18N.people_graph.choose_person | translate }}</option>@for (candidate of candidates(); track candidate.id) { <option [ngValue]="candidate.id">{{ candidate.name || (I18N.people_graph.unnamed | translate) }}</option> }</select></label>
                <label class="text-sm">{{ I18N.people_graph.direction | translate }}<select name="direction" class="mt-1 w-full rounded-lg border bg-[var(--mat-sys-surface)] p-2 focus-visible:outline-2" [ngModel]="reverseConnection" (ngModelChange)="reverseConnection = $event; updateConnectionPreview()"><option [ngValue]="false">{{ I18N.people_graph.selected_first | translate }}</option><option [ngValue]="true">{{ I18N.people_graph.other_first | translate }}</option></select></label>
                <p class="rounded-lg bg-[var(--mat-sys-surface-container)] p-3 text-sm" aria-live="polite">{{ reverseConnection ? targetName() : (selected()?.name || (I18N.people_graph.unnamed | translate)) }} {{ connectionLabel() }} {{ reverseConnection ? (selected()?.name || (I18N.people_graph.unnamed | translate)) : targetName() }}</p>
                <div class="grid grid-cols-2 gap-2"><label class="text-sm">{{ I18N.people_graph.from | translate }}<input type="date" class="mt-1 w-full rounded-lg border bg-transparent p-2 focus-visible:outline-2" name="startsOn" [(ngModel)]="startsOn" /></label><label class="text-sm">{{ I18N.people_graph.until | translate }}<input type="date" class="mt-1 w-full rounded-lg border bg-transparent p-2 focus-visible:outline-2" name="endsOn" [(ngModel)]="endsOn" /></label></div>
                <button class="min-h-11 min-w-11 rounded-lg border px-4 py-2 disabled:cursor-not-allowed disabled:bg-[var(--mat-sys-surface-container)] disabled:text-[var(--mat-sys-on-surface-variant)] focus-visible:outline-2" [disabled]="saving() || !target">{{ I18N.people_graph.connect | translate }}</button>
              </form>
              <details class="mt-5"><summary class="cursor-pointer rounded-lg py-2 text-sm focus-visible:outline-2">{{ I18N.people_graph.custom | translate }}</summary><form class="mt-3 flex flex-col gap-3" (ngSubmit)="createType()"><label class="text-sm">{{ I18N.people_graph.forward | translate }}<input class="mt-1 w-full rounded-lg border bg-transparent p-2 focus-visible:outline-2" name="forward" [(ngModel)]="forwardLabel"  maxlength="80" /></label><label class="text-sm">{{ I18N.people_graph.reverse | translate }}<input class="mt-1 w-full rounded-lg border bg-transparent p-2 focus-visible:outline-2" name="reverse" [(ngModel)]="reverseLabel"  maxlength="80" /></label><label class="flex items-center gap-2 text-sm"><input type="checkbox" name="mutual" [(ngModel)]="mutual" />{{ I18N.people_graph.mutual | translate }}</label><button class="min-h-11 min-w-11 rounded-lg border px-3 py-2 text-sm focus-visible:outline-2" [disabled]="saving() || !forwardLabel || (!mutual && !reverseLabel)">{{ I18N.people_graph.create_type | translate }}</button></form></details>

            }
            </div>
            <section data-inspector-panel="groups" [hidden]="profileTab() !== 'groups'"><h3 class="font-medium">{{ I18N.people_graph.groups | translate }}</h3>
              <ul class="mt-3 space-y-2">@for (group of memberships(); track group.id) { <li class="flex items-center justify-between gap-2"><span>{{ group.name }}</span>@if (auth.isEdition() && group.can_edit) { <button class="min-h-11 min-w-11 rounded-lg border px-2 py-1 text-sm focus-visible:outline-2" [disabled]="saving()" (click)="membership(group.id, false)">{{ I18N.people_graph.remove | translate }}</button> }</li> }</ul>
              @if (auth.isEdition()) {
                <label class="mt-4 block text-sm">{{ I18N.people_graph.add_group | translate }}<select class="mt-1 w-full rounded-lg border bg-[var(--mat-sys-surface)] p-2 focus-visible:outline-2" [(ngModel)]="groupTarget"><option value="">{{ I18N.people_graph.choose_group | translate }}</option>@for (group of editableGroupLabels(); track group.id) { <option [value]="group.id">{{ group.label }}</option> }</select></label>
                <button class="min-h-11 min-w-11 mt-2 rounded-lg border px-3 py-2 text-sm focus-visible:outline-2" [disabled]="saving() || !groupTarget" (click)="membership(groupTarget, true)">{{ I18N.people_graph.membership | translate }}</button>
                <button class="min-h-11 min-w-11 mt-4 rounded-lg px-3 py-2 text-sm underline focus-visible:outline-2" (click)="toggleCreation('group')">{{ I18N.people_graph.new_group | translate }}</button>
              }
              @if (auth.isEdition()) {
                <details class="mt-5"><summary class="cursor-pointer rounded-lg py-2 text-sm focus-visible:outline-2">{{ I18N.people_graph.edit_group | translate }}</summary>
                  <label class="mt-3 block text-sm">{{ I18N.people_graph.group | translate }}<select class="mt-1 w-full rounded-lg border bg-[var(--mat-sys-surface)] p-2 focus-visible:outline-2" [ngModel]="groupEdit" (ngModelChange)="chooseGroupEdit($event)"><option value="">{{ I18N.people_graph.choose_group | translate }}</option>@for (group of editableGroups(); track group.id) { <option [value]="group.id">{{ group.name }}</option> }</select></label>
                  @if (groupEdit) {
                    <form class="mt-3 flex flex-col gap-3" (ngSubmit)="updateGroup(false)"><label class="text-sm">{{ I18N.people_graph.group_name | translate }}<input class="mt-1 w-full rounded-lg border bg-transparent p-2 focus-visible:outline-2" name="editGroupName" [(ngModel)]="groupEditName" maxlength="100" /></label>
                      <label class="text-sm">{{ I18N.people_graph.parent_group | translate }}<select class="mt-1 w-full rounded-lg border bg-[var(--mat-sys-surface)] p-2 focus-visible:outline-2" name="editGroupParent" [(ngModel)]="groupEditParent"><option value="">{{ I18N.people_graph.no_parent | translate }}</option>@for (group of editableGroups(); track group.id) { @if (group.id !== groupEdit) { <option [value]="group.id">{{ group.name }}</option> } }</select></label>
                      <button class="min-h-11 min-w-11 rounded-lg border px-3 py-2 text-sm focus-visible:outline-2" [disabled]="saving() || !groupEditName">{{ I18N.people_graph.save_group | translate }}</button>
                    </form>
                    <label class="mt-5 flex items-start gap-2 text-sm"><input type="checkbox" class="mt-1" [(ngModel)]="confirmGroupDelete" />{{ I18N.people_graph.delete_group_help | translate }}</label><button class="min-h-11 min-w-11 mt-2 rounded-lg border px-3 py-2 text-sm focus-visible:outline-2 disabled:cursor-not-allowed disabled:bg-[var(--mat-sys-surface-container)] disabled:text-[var(--mat-sys-on-surface-variant)]" [disabled]="saving() || !confirmGroupDelete" (click)="updateGroup(true)">{{ I18N.people_graph.delete_group | translate }}</button>
                  }
                </details>
              }
            </section>
            </div>
            @if (notice()) { <p role="status" class="mt-4 text-sm">{{ notice() }}</p> }
          </aside>
        }
        }
      </div>
    </main>
  `,
})
export class PeopleGraphComponent {
  protected readonly I18N = i18nKeys();
  private readonly api = inject(ApiService);
  private readonly creationMenu = viewChild<ElementRef<HTMLDetailsElement>>('creationMenu');
  private readonly creationInput = viewChild<ElementRef<HTMLInputElement>>('creationInput');
  private readonly connectionHeading = viewChild<ElementRef<HTMLElement>>('connectionHeading');
  private readonly profileHeading = viewChild<ElementRef<HTMLElement>>('profileHeading');
  private profileReturnFocus: HTMLElement | null = null;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);
  private alive = true;
  private revision = 0;
  private reloadEpoch = 0;
  readonly people = signal<GraphPerson[]>([]);
  readonly selected = signal<GraphPerson | null>(null);
  readonly depth = signal(1);
  readonly networkPeople = signal<GraphPerson[]>([]);
  readonly networkConnections = signal<Connection[]>([]);
  readonly connections = signal<Connection[]>([]);
  private readonly drafts = new Map<number, string>();
  private loadedNote = '';
  readonly types = signal<ConnectionType[]>([]);
  readonly tags = signal<{ id: string; label: string }[]>([]);
  private tagsLoading = false;
  readonly groups = signal<PeopleGroup[]>([]);
  readonly members = signal<GroupMember[]>([]);
  readonly activeGroup = signal('');
  readonly relationshipFilter = signal('');
  readonly editableGroups = computed(() => this.groups().filter(group => group.can_edit));
  readonly groupLabels = computed(() => this.groups().map(group => {
    const labels = [group.name];
    const seen = new Set([group.id]);
    let parent = group.parent_id;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const ancestor = this.groups().find(item => item.id === parent);
      if (!ancestor) break;
      labels.unshift(ancestor.name);
      parent = ancestor.parent_id;
    }
    return { ...group, label: labels.join(' / ') };
  }));
  readonly editableGroupLabels = computed(() => this.groupLabels().filter(group => group.can_edit));
  groupEdit = '';
  groupEditName = '';
  groupEditParent = '';
  confirmGroupDelete = false;
  readonly memberships = computed(() => this.groups().filter(g => this.members().some(m => m.group_id === g.id && m.person_id === this.selected()?.id)));
  readonly creationMode = signal<'person' | 'group' | null>(null);
  readonly creationNotice = signal('');
  personName = '';
  groupParent = '';
  private creationReturnFocus: HTMLElement | null = null;
  private creationRestoreSheet = false;
  groupTarget = '';
  groupName = '';
  readonly search = signal('');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly noteReady = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly hierarchyView = signal(true);
  readonly detailsOpen = signal(false);
  readonly profileTab = signal<'connections' | 'groups' | 'notes'>('connections');
  readonly connectionEditor = signal(false);
  readonly filtersOpen = signal(false);
  readonly sheetExpanded = signal(false);
  readonly viewport = signal({ width: 900, height: 700 });
  readonly wideScreen = signal(window.matchMedia('(min-width: 1024px)').matches);
  readonly connectionRevision = signal(0);
  readonly motionEnabled = signal(true);
  readonly reducedMotion = signal(false);
  private frame = 0;
  private keyboardNavigation = false;
  readonly hovering = signal(false);
  readonly interacting = signal(false);
  private readonly keyboardMode = signal(false);
  private readonly pageVisible = signal(!document.hidden);
  private readonly ambientTime = signal(0);
  private ambientFrame = 0;
  private readonly zone = inject(NgZone);
  private readonly animatedPoints = signal<GraphPoint[]>([]);
  readonly filtered = computed(() => this.people().filter(p => (p.name || '').toLocaleLowerCase().includes(this.search().toLocaleLowerCase()) && (!this.activeGroup() || this.members().some(m => m.group_id === this.activeGroup() && m.person_id === p.id))));
  private readonly interaction = viewChild(PeopleGraphInteractionDirective);
  readonly camera = signal(zoomIdentity);
  readonly pinned = signal<Map<number, GraphPoint>>(new Map());
  private readonly fittedPoints = signal<GraphPoint[] | null>(null);
  readonly positionForDrag = (id: number): GraphPoint => {
    const pinned = this.pinned().get(id);
    if (pinned) return pinned;
    const point = this.animatedPoints().find(point => point.id === id) || this.graphTargets().find(point => point.id === id) || { id, x: 450, y: 350 };
    return id === this.selected()?.id ? point : ambientPeoplePoint(point, this.ambientTime());
  };
  readonly selectedPoint = computed(() => this.positionForDrag(this.selected()?.id || 0));
  readonly graphTargets = computed(() => this.hierarchyView() ? [] : organicPeopleLayout(this.networkPeople().map(person => person.id), this.networkConnections(), this.selected()?.id || 0));
  readonly graphBounds = computed(() => {
    const points = this.fittedPoints() || this.graphTargets();
    if (!points.length) return { x: 450, y: 350, width: 600, height: 450 };
    const minX = Math.min(...points.map(point => point.x));
    const maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxY = Math.max(...points.map(point => point.y));
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, width: Math.max(600, maxX - minX + 210), height: Math.max(450, maxY - minY + 190) };
  });
  readonly viewBox = computed(() => {
    const bounds = this.graphBounds();
    const viewport = this.viewport();
    const reservedBottom = !this.wideScreen() && this.detailsOpen() ? 240 : 90;
    const reservedTop = this.wideScreen() ? 30 : 12;
    const scale = Math.min(viewport.width / bounds.width, Math.max(120, viewport.height - reservedBottom - reservedTop) / bounds.height);
    const width = viewport.width / scale;
    const height = viewport.height / scale;
    return `${bounds.x - width / 2} ${bounds.y - bounds.height / 2 - reservedTop / scale} ${width} ${height}`;
  });
  readonly labelSize = computed(() => {
    const [, , , height] = this.viewBox().split(' ').map(Number);
    const scale = this.viewport().height / height;
    return Math.min(34, Math.max(16, 14 / scale));
  });
  readonly graphNodes = computed(() => {
    const neighbors = this.networkPeople().filter(person => person.id !== this.selected()?.id && (!this.relationshipFilter() || this.networkConnections().some(edge => edge.type_id === this.relationshipFilter() && (edge.source_id === person.id || edge.target_id === person.id))));
    return neighbors.map(person => {
      const point = this.positionForDrag(person.id);
      const x = point?.x ?? 450;
      const y = point?.y ?? 350;
      const labels = this.networkConnections().filter(edge => edge.source_id === person.id || edge.target_id === person.id).map(edge => {
        const other = edge.source_id === person.id ? edge.target_id : edge.source_id;
        const name = this.networkPeople().find(p => p.id === other)?.name || '';
        return `${this.label(edge.type_id, edge.source_id === person.id, edge.source_id === person.id ? edge.forward_label : edge.reverse_label)} ${name}`;
      });
      const directLabel = this.networkConnections().filter(edge =>
        (edge.source_id === person.id && edge.target_id === this.selected()?.id) ||
        (edge.target_id === person.id && edge.source_id === this.selected()?.id))
        .map(edge => this.label(edge.type_id, edge.source_id === person.id, edge.source_id === person.id ? edge.forward_label : edge.reverse_label)).join(', ');
      const family = this.networkConnections().some(edge => ['parent', 'sibling', 'partner'].includes(edge.type_id) && (edge.source_id === person.id || edge.target_id === person.id));
      return { person, x, y, directLabel, personId: person.id, portrait: person.face_thumbnail, label: labels.join(', '), color: family ? 'var(--facet-graph-family)' : 'var(--facet-graph-social)' };
    });
  });
  readonly graphLines = computed(() => {
    const positions = new Map(this.graphNodes().map(node => [node.personId, { x: node.x, y: node.y }]));
    const selected = this.selected();
    if (selected) positions.set(selected.id, this.selectedPoint());
    return this.networkConnections().filter(edge => !this.relationshipFilter() || edge.type_id === this.relationshipFilter()).flatMap(edge => {
      const source = positions.get(edge.source_id);
      const target = positions.get(edge.target_id);
      if (!source || !target) return [];
      const bendX = (source.x + target.x) / 2 + (target.y - source.y) * 0.12;
      const bendY = (source.y + target.y) / 2 - (target.x - source.x) * 0.12;
      const color = ['parent', 'sibling', 'partner'].includes(edge.type_id) ? 'var(--facet-graph-family)' : 'var(--facet-graph-social)';
      return source && target ? [{ id: edge.id, color, path: `M ${source.x} ${source.y} Q ${bendX} ${bendY} ${target.x} ${target.y}` }] : [];
    });
  });
  private label(kind: string, forward: boolean, fallback: string): string {
    const labels: Record<string, string> = { parent: forward ? this.I18N.people_graph.parent : this.I18N.people_graph.child,
      sibling: this.I18N.people_graph.sibling, partner: this.I18N.people_graph.partner,
      friend: this.I18N.people_graph.friend, coworker: this.I18N.people_graph.coworker };
    return labels[kind] ? this.i18n.t(labels[kind]) : fallback;
  }
  readonly displayConnections = computed(() => this.connections().filter(edge => !this.relationshipFilter() || edge.type_id === this.relationshipFilter()).map(edge => ({ ...edge,
    forward_label: this.label(edge.type_id, true, edge.forward_label), reverse_label: this.label(edge.type_id, false, edge.reverse_label) })));
  readonly displayTypes = computed(() => this.types().map(type => ({ ...type, forward_label: this.label(type.id, true, type.forward_label) })));
  readonly candidates = computed(() => this.people().filter(p => p.id !== this.selected()?.id));
  note = '';
  kind = 'friend';
  renameName = '';
  reverseConnection = false;
  readonly targetName = signal('');
  readonly connectionLabel = signal('');
  startsOn = '';
  endsOn = '';
  forwardLabel = '';
  reverseLabel = '';
  mutual = false;
  target: number | null = null;

  constructor() {
    const wide = window.matchMedia('(min-width: 1024px)');
    const widthChanged = () => this.wideScreen.set(wide.matches);
    wide.addEventListener('change', widthChanged);
    inject(DestroyRef).onDestroy(() => wide.removeEventListener('change', widthChanged));
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion.set(media.matches);
    const motionChanged = () => this.reducedMotion.set(media.matches);
    media.addEventListener('change', motionChanged);
    const keyboard = () => { this.keyboardMode.set(true); this.keyboardNavigation = true; cancelAnimationFrame(this.frame); this.animatedPoints.set(this.graphTargets()); };
    const pointer = () => { this.keyboardMode.set(false); this.keyboardNavigation = false; };
    const visibility = () => this.pageVisible.set(!document.hidden);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('keydown', keyboard);
    document.addEventListener('pointerdown', pointer);
    effect(() => {
      const targets = this.graphTargets();
      this.reducedMotion(); this.motionEnabled(); this.hierarchyView();
      untracked(() => this.animateLayout(targets));
    });
    effect(onCleanup => {
      if (this.hierarchyView() || !this.motionEnabled() || this.reducedMotion() || this.hovering() || this.interacting() || this.keyboardMode() || !this.pageVisible() || !this.networkPeople().length) return;
      let previous = 0;
      this.zone.runOutsideAngular(() => {
        const tick = (now: number) => {
          if (!this.alive) return;
          if (!previous) previous = now;
          if (now - previous >= 32) {
            const elapsed = Math.min(0.1, (now - previous) / 1000);
            previous = now;
            this.ambientTime.update(time => time + elapsed);
          }
          this.ambientFrame = requestAnimationFrame(tick);
        };
        this.ambientFrame = requestAnimationFrame(tick);
      });
      onCleanup(() => cancelAnimationFrame(this.ambientFrame));
    });
    inject(DestroyRef).onDestroy(() => { cancelAnimationFrame(this.frame); cancelAnimationFrame(this.ambientFrame); document.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', motionChanged); document.removeEventListener('keydown', keyboard); document.removeEventListener('pointerdown', pointer); });
    const subscription = this.route.queryParamMap.subscribe(params => {
      const identity = Number(params.get('person'));
      const person = this.people().find(item => item.id === identity);
      if (person && this.selected()?.id !== person.id) void this.select(person);
    });
    inject(DestroyRef).onDestroy(() => { this.alive = false; this.revision++; subscription.unsubscribe(); });
    effect(() => {
      this.auth.identity();
      this.revision++;
      this.ambientTime.set(0);
      this.interacting.set(false);
      this.pinned.set(new Map());
      this.fittedPoints.set(null);
      this.camera.set(zoomIdentity);
      untracked(() => this.interaction()?.reset());
      this.people.set([]);
      this.tags.set([]);
      this.groups.set([]);
      this.members.set([]);
      this.activeGroup.set('');
      this.selected.set(null);
      this.connections.set([]);
      this.networkPeople.set([]);
      this.networkConnections.set([]);
      this.note = '';
      this.drafts.clear();
      this.noteReady.set(false);
      this.types.set([]);
      this.profileTab.set('connections');
      this.sheetExpanded.set(false);
      this.filtersOpen.set(false);
      this.connectionEditor.set(false);
      this.detailsOpen.set(false);
      this.profileReturnFocus = null;
      this.groupEdit = '';
      this.groupEditName = '';
      this.groupEditParent = '';
      this.creationMode.set(null);
      this.creationNotice.set('');
      this.personName = '';
      this.renameName = '';
      this.targetName.set('');
      this.connectionLabel.set('');
      this.reverseConnection = false;
      this.groupParent = '';
      this.creationReturnFocus = null;
      this.creationRestoreSheet = false;
      this.groupName = '';
      this.groupTarget = '';
      this.confirmGroupDelete = false;
      this.forwardLabel = '';
      this.reverseLabel = '';
      this.target = null;
      this.kind = 'friend';
      this.startsOn = '';
      this.endsOn = '';
      this.mutual = false;
      this.search.set('');
      this.relationshipFilter.set('');
      this.notice.set('');
      this.loadedNote = '';
      void this.reload();
    });
  }

  async reload(): Promise<void> {
    const epoch = ++this.reloadEpoch;
    const revision = ++this.revision;
    this.loading.set(true);
    this.error.set('');
    try {
      const result = { persons: [] as GraphPerson[] };
      let page = 1;
      let total = 0;
      do {
        const batch = await firstValueFrom(this.api.get<{ persons: GraphPerson[]; total: number }>('/persons', { page, per_page: 200, sort: 'name_asc' }));
        if (!this.alive || revision !== this.revision) return;
        result.persons.push(...batch.persons);
        total = batch.total;
        page++;
        if (!batch.persons.length) break;
      } while (result.persons.length < total);
      const organization = await firstValueFrom(this.api.get<{ groups: PeopleGroup[]; members: GroupMember[] }>('/people-graph/groups'));
      if (!this.alive || revision !== this.revision) return;
      this.people.set(result.persons);
      this.groups.set(organization.groups);
      this.members.set(organization.members);
      const requested = Number(this.route.snapshot.queryParamMap.get('person'));
      const person = result.persons.find(p => p.id === requested) || result.persons.find(p => p.id === this.selected()?.id) || result.persons[0];
      if (person) await this.select(person);
    } catch { if (this.alive && epoch === this.reloadEpoch && revision === this.revision) this.error.set(this.i18n.t(this.I18N.people_graph.load_error)); }
    finally { if (this.alive && epoch === this.reloadEpoch) this.loading.set(false); }
  }

  async select(person: GraphPerson): Promise<void> {
    const previous = this.selected();
    if (previous && this.noteReady() && this.note !== this.loadedNote) this.drafts.set(previous.id, this.note);
    const revision = ++this.revision;
    if (previous?.id !== person.id || this.hierarchyView()) { this.networkPeople.set([]); this.networkConnections.set([]); }
    this.error.set('');
    if (previous?.id !== person.id) { this.fittedPoints.set(null); this.interaction()?.reset(); this.camera.set(zoomIdentity); }
    this.selected.set(person);
    this.renameName = person.name || "";
    if (this.route.snapshot.queryParamMap.get('person') !== String(person.id)) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: { person: person.id }, queryParamsHandling: 'merge' });
    }
    this.connections.set([]);
    this.note = '';
    this.noteReady.set(false);
    this.target = null;
    this.updateConnectionPreview();
    this.notice.set('');
    if (this.hierarchyView() && !this.detailsOpen()) return;
    try {
      const [graph, note, network] = await Promise.all([
        firstValueFrom(this.api.get<{ connections: Connection[]; types: ConnectionType[] }>(`/people-graph/connections/${person.id}`)),
        this.detailsOpen() ? firstValueFrom(this.api.get<{ body: string }>(`/people-graph/notes/${person.id}`)) : Promise.resolve({ body: '' }),
        this.hierarchyView() ? Promise.resolve({ people: [], connections: [] }) : firstValueFrom(this.api.get<{ people: GraphPerson[]; connections: Connection[] }>(`/people-graph/neighborhood/${person.id}`, { depth: this.depth() })),
      ]);
      if (!this.alive || revision !== this.revision) return;
      this.networkPeople.set(network.people);
      this.networkConnections.set(network.connections);
      this.connections.set(graph.connections);
      this.types.set(graph.types);
      this.updateConnectionPreview();
      this.loadedNote = note.body;
      this.note = this.drafts.get(person.id) ?? note.body;
      this.noteReady.set(this.detailsOpen());
    } catch { if (this.alive && revision === this.revision) this.error.set(this.i18n.t(this.I18N.people_graph.profile_error)); }
  }

  showHierarchy(): void { this.hovering.set(false); this.interacting.set(false); this.hierarchyView.set(true); }
  showGraph(): void { this.hierarchyView.set(false); const person = this.selected(); if (person) void this.select(person); }

  toggleProfile(): void {
    if (this.detailsOpen()) this.closeProfile();
    else { const person = this.selected(); if (person) this.openProfile(person); }
  }

  selectById(identity: number): void { const person = this.people().find(person => person.id === identity); if (person) void this.select(person); }
  closeProfile(): void {
    this.detailsOpen.set(false);
    this.sheetExpanded.set(false);
    queueMicrotask(() => {
      if (!this.alive) return;
      const fallback = document.querySelector<HTMLElement>('app-people-graph button[aria-pressed="true"]');
      const target = this.profileReturnFocus?.isConnected ? this.profileReturnFocus : fallback;
      target?.focus({ preventScroll: window.innerWidth >= 1024 });
    });
  }
  openProfile(person: GraphPerson, focusConnection = false): void {
    const origin = document.activeElement;
    if (origin instanceof HTMLElement && origin.closest('app-people-graph')) this.profileReturnFocus = origin;
    if (focusConnection) { this.sheetExpanded.set(true); this.profileTab.set('connections'); this.connectionEditor.set(true); }
    this.detailsOpen.set(true);
    void this.select(person).then(() => {
      if (this.alive && this.detailsOpen() && this.selected()?.id === person.id) (focusConnection ? this.connectionHeading() : this.profileHeading())?.nativeElement.focus({ preventScroll: window.innerWidth >= 1024 });
    });
  }

  private animateLayout(targets: GraphPoint[]): void {
    cancelAnimationFrame(this.frame);
    if (this.hierarchyView()) { this.animatedPoints.set([]); return; }
    if (!targets.length || this.reducedMotion() || !this.motionEnabled() || this.keyboardNavigation) { this.animatedPoints.set(targets); return; }
    const previous = new Map(this.animatedPoints().map(point => [point.id, point]));
    const start = performance.now();
    const tick = (now: number) => {
      if (!this.alive) return;
      const progress = Math.min(1, (now - start) / 650);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.animatedPoints.set(targets.map(point => {
        const origin = previous.get(point.id) || { x: 450 + (point.x - 450) * 0.82, y: 350 + (point.y - 350) * 0.82 };
        return { id: point.id, x: origin.x + (point.x - origin.x) * eased, y: origin.y + (point.y - origin.y) * eased };
      }));
      if (progress < 1) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  follow(edge: Connection): void {
    const identity = edge.source_id === this.selected()?.id ? edge.target_id : edge.source_id;
    const person = this.people().find(p => p.id === identity);
    if (person) void this.select(person);
  }

  updateConnectionPreview(): void {
    this.targetName.set(this.people().find(person => person.id === this.target)?.name || this.i18n.t(this.I18N.people_graph.choose_person));
    const type = this.types().find(type => type.id === this.kind);
    this.connectionLabel.set(type ? this.label(type.id, true, type.forward_label) : '');
  }
  toggleCreation(mode: 'person' | 'group'): void {
    if (this.creationMode() === mode) { this.closeCreation(); return; }
    this.creationReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menu = this.creationMenu()?.nativeElement;
    if (menu?.open && !this.wideScreen()) { this.creationReturnFocus = menu.querySelector('summary'); menu.open = false; }
    if (!this.wideScreen() && this.sheetExpanded()) { this.creationRestoreSheet = true; this.sheetExpanded.set(false); }
    this.creationMode.set(mode);
    this.creationNotice.set('');
    setTimeout(() => { if (this.alive) this.creationInput()?.nativeElement.focus(); });
  }
  closeCreation(): void {
    this.creationMode.set(null);
    const restoreSheet = this.creationRestoreSheet && this.detailsOpen() && !this.wideScreen();
    this.creationRestoreSheet = false;
    if (restoreSheet) this.sheetExpanded.set(true);
    setTimeout(() => { if (this.alive && this.creationReturnFocus?.isConnected) this.creationReturnFocus.focus(); });

  }
  startConnection(): void {
    const person = this.selected();
    if (!person) return;
    const menu = this.creationMenu()?.nativeElement;
    if (menu && !this.wideScreen()) menu.open = false;
    this.openProfile(person, true);
  }
  async createPerson(): Promise<void> {
    if (!this.personName.trim() || this.saving()) return;
    this.saving.set(true);
    const identity = this.auth.identity();
    try {
      const created = await firstValueFrom(this.api.post<GraphPerson>('/persons', { name: this.personName.trim() }));
      if (!this.alive || identity !== this.auth.identity()) return;
      this.personName = '';
      this.closeCreation();
      this.creationNotice.set(this.i18n.t(this.I18N.people_graph.person_created));
      this.search.set(''); this.activeGroup.set('');
      await this.reload();
      if (!this.alive || identity !== this.auth.identity() || this.error()) return;
      const person = this.people().find(person => person.id === created.id);
      this.closeCreation();
      this.creationNotice.set(this.i18n.t(person ? this.I18N.people_graph.person_created : this.I18N.people_graph.person_needs_face));
      if (person) this.openProfile(person);
    } catch { if (this.alive && identity === this.auth.identity()) this.error.set(this.i18n.t(this.I18N.people_graph.person_error)); }
    finally { if (this.alive) this.saving.set(false); }
  }
  async renamePerson(): Promise<void> {
    const person = this.selected();
    if (!person || !this.renameName.trim() || this.saving()) return;
    this.saving.set(true);
    const identity = this.auth.identity();
    try {
      await firstValueFrom(this.api.post(`/persons/${person.id}/rename`, { name: this.renameName.trim() }));
      if (this.alive && identity === this.auth.identity()) await this.reload();
    } catch { if (this.alive && identity === this.auth.identity()) this.error.set(this.i18n.t(this.I18N.people_graph.person_error)); }
    finally { if (this.alive) this.saving.set(false); }
  }

  async createType(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    const revision = this.revision;
    try {
      const result = await firstValueFrom(this.api.post<{ id: string }>('/people-graph/types', { forward_label: this.forwardLabel, reverse_label: this.mutual ? this.forwardLabel : this.reverseLabel, mutual: this.mutual }));
      const person = this.selected();
      if (!this.alive || revision !== this.revision || !person) return;
      await this.select(person);
      this.kind = result.id;
      this.updateConnectionPreview();
      this.forwardLabel = '';
      this.reverseLabel = '';
    } catch { if (this.alive && revision === this.revision) this.error.set(this.i18n.t(this.I18N.people_graph.type_error)); }
    finally { if (this.alive) this.saving.set(false); }
  }

  async disconnect(edge: Connection): Promise<void> {
    const person = this.selected();
    if (!person || this.saving()) return;
    this.saving.set(true);
    const revision = this.revision;
    const identity = this.auth.identity();
    try {
      await firstValueFrom(this.api.delete(`/people-graph/connections/${edge.id}`));
      if (this.alive && identity === this.auth.identity()) this.connectionRevision.update(value => value + 1);
      if (this.alive && revision === this.revision) await this.select(person);
    } catch { if (this.alive && revision === this.revision) this.error.set(this.i18n.t(this.I18N.people_graph.remove_error)); }
    finally { if (this.alive) this.saving.set(false); }
  }

  changeDepth(depth: number): void {
    this.fittedPoints.set(null);
    this.depth.set(depth);
    const person = this.selected();
    if (person) void this.select(person);
  }

  zoomBy(factor: number): void { this.interaction()?.zoomBy(factor); }
  beginInteraction(): void { this.interacting.set(true); cancelAnimationFrame(this.frame); }
  movePerson(point: GraphPoint): void {
    this.pinned.update(points => new Map(points).set(point.id, point));
  }
  fit(): void {
    this.fittedPoints.set(this.graphTargets().map(point => this.pinned().get(point.id) || point));
    this.interaction()?.reset();
    this.camera.set(zoomIdentity);
  }
  resetLayout(): void {
    this.pinned.set(new Map());
    this.animatedPoints.set(this.graphTargets());
    this.fit();
  }

  async loadTags(): Promise<void> {
    if (this.tagsLoading) return;
    this.tagsLoading = true;
    const revision = this.revision;
    try {
      const result = await firstValueFrom(this.api.get<{ nodes: { id: string; segments: string[] }[] }>('/manual_tags/hierarchy'));
      if (this.alive && revision === this.revision) this.tags.set(result.nodes.map(node => ({ id: node.id, label: node.segments.join(' / ') })));
    } catch { if (this.alive && revision === this.revision) this.error.set(this.i18n.t(this.I18N.people_graph.tags_error)); }
    finally { this.tagsLoading = false; }
  }

  async membership(group: string, add: boolean): Promise<void> {
    const person = this.selected();
    if (!person || this.saving()) return;
    this.saving.set(true);
    const revision = this.revision;
    try {
      const path = `/people-graph/groups/${group}/members/${person.id}`;
      await firstValueFrom(add ? this.api.put(path, {}) : this.api.delete(path));
      const organization = await firstValueFrom(this.api.get<{ groups: PeopleGroup[]; members: GroupMember[] }>('/people-graph/groups'));
      if (!this.alive || revision !== this.revision) return;
      this.groups.set(organization.groups);
      this.members.set(organization.members);
      this.groupTarget = '';
    } catch { if (this.alive && revision === this.revision) this.error.set(this.i18n.t(this.I18N.people_graph.membership_error)); }
    finally { if (this.alive) this.saving.set(false); }
  }

  chooseGroupEdit(identity: string): void {
    const group = this.groups().find(item => item.id === identity);
    this.groupEdit = identity;
    this.groupEditName = group?.name || '';
    this.groupEditParent = group?.parent_id || '';
    this.confirmGroupDelete = false;
  }

  async updateGroup(remove: boolean): Promise<void> {
    if (!this.groupEdit || this.saving() || (remove && !this.confirmGroupDelete)) return;
    this.saving.set(true);
    const revision = this.revision;
    try {
      const path = `/people-graph/groups/${this.groupEdit}`;
      await firstValueFrom(remove ? this.api.delete(path) : this.api.put(path, { name: this.groupEditName, parent_id: this.groupEditParent || null }));
      const organization = await firstValueFrom(this.api.get<{ groups: PeopleGroup[]; members: GroupMember[] }>('/people-graph/groups'));
      if (!this.alive || revision !== this.revision) return;
      this.groups.set(organization.groups);
      this.members.set(organization.members);
      if (remove) { this.activeGroup.set(''); this.chooseGroupEdit(''); }
    } catch { if (this.alive && revision === this.revision) this.error.set(this.i18n.t(this.I18N.people_graph.group_error)); }
    finally { if (this.alive) this.saving.set(false); }
  }

  async createGroup(): Promise<void> {
    if (!this.groupName.trim() || this.saving()) return;
    this.saving.set(true);
    const identity = this.auth.identity();
    let created = false;
    try {
      await firstValueFrom(this.api.post('/people-graph/groups', { name: this.groupName.trim(), parent_id: this.groupParent || null }));
      if (!this.alive || identity !== this.auth.identity()) return;
      created = true;
      this.groupName = '';
      this.groupParent = '';
      this.creationNotice.set(this.i18n.t(this.I18N.people_graph.group_created));
      this.closeCreation();
      const organization = await firstValueFrom(this.api.get<{ groups: PeopleGroup[]; members: GroupMember[] }>('/people-graph/groups'));
      if (!this.alive || identity !== this.auth.identity()) return;
      this.groups.set(organization.groups);
      this.members.set(organization.members);
    } catch {
      if (this.alive && identity === this.auth.identity()) this.error.set(this.i18n.t(created ? this.I18N.people_graph.load_error : this.I18N.people_graph.group_error));
    }
    finally { if (this.alive) this.saving.set(false); }
  }

  async saveNote(): Promise<void> {
    const person = this.selected();
    if (!person || this.saving() || !this.noteReady()) return;
    this.saving.set(true);
    const revision = this.revision;
    const body = this.note;
    try {
      await firstValueFrom(this.api.put(`/people-graph/notes/${person.id}`, { body }));
      if (this.alive && revision === this.revision) {
        this.loadedNote = body;
        if (this.note === body) this.drafts.delete(person.id);
        else this.drafts.set(person.id, this.note);
        this.notice.set(this.i18n.t(this.I18N.people_graph.saved));
      }
    } catch { if (this.alive && revision === this.revision) this.error.set(this.i18n.t(this.I18N.people_graph.save_error)); }
    finally { if (this.alive) this.saving.set(false); }
  }

  async connect(): Promise<void> {
    const person = this.selected();
    if (!person || !this.target || this.saving()) return;
    this.saving.set(true);
    const revision = this.revision;
    const identity = this.auth.identity();
    try {
      await firstValueFrom(this.api.post('/people-graph/connections', { source_id: this.reverseConnection ? this.target : person.id, target_id: this.reverseConnection ? person.id : this.target, type_id: this.kind, starts_on: this.startsOn || null, ends_on: this.endsOn || null }));
      if (this.alive && identity === this.auth.identity()) this.connectionRevision.update(value => value + 1);
      if (this.alive && revision === this.revision) await this.select(person);
    } catch (error: unknown) {
      if (this.alive && revision === this.revision) {
        const detail = (error as { error?: { detail?: unknown } })?.error?.detail;
        const messages: Record<string, string> = {
          'This connection already exists': this.I18N.people_graph.duplicate_connection,
          'Parent connection would create an ancestry cycle': this.I18N.people_graph.ancestry_error,
          'End date precedes start date': this.I18N.people_graph.date_error,
        };
        this.error.set(this.i18n.t(typeof detail === 'string' && messages[detail] || this.I18N.people_graph.connection_error));
      }
    }
    finally { if (this.alive) this.saving.set(false); }
  }
}
