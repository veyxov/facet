import { AfterViewInit, DestroyRef, Directive, ElementRef, inject, input, output } from '@angular/core';
import { drag, dragEnable } from 'd3-drag';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, ZoomTransform } from 'd3-zoom';
import { GraphPoint } from './people-graph-layout';

/** D3 owns gesture transforms; Angular owns the graph and person positions. */
@Directive({ selector: 'svg[appPeopleGraphInteraction]' })
export class PeopleGraphInteractionDirective implements AfterViewInit {
  readonly position = input.required<(id: number) => GraphPoint>();
  readonly initialCamera = input<ZoomTransform>(zoomIdentity);
  readonly moved = output<GraphPoint>();
  readonly started = output<void>();
  readonly finished = output<void>();
  readonly cameraChanged = output<ZoomTransform>();
  readonly viewportChanged = output<{ width: number; height: number }>();
  private resizeObserver?: ResizeObserver;
  private readonly svg = inject<ElementRef<SVGSVGElement>>(ElementRef).nativeElement;
  private alive = true;
  private activeMouse = false;
  private readonly bound = new WeakSet<SVGGElement>();
  private readonly camera = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.25, 4])
    .extent(() => {
      const [x, y, width, height] = (this.svg.getAttribute('viewBox') || '0 0 900 700').split(/\s+/).map(Number);
      return [[x, y], [x + width, y + height]];
    })
    .filter(event => (!event.button && !event.target.closest('[data-graph-node]')) || event.type === 'wheel')
    .on('start', event => { if (event.sourceEvent?.type === 'mousedown') this.activeMouse = true; if (event.sourceEvent && this.alive) this.started.emit(); })
    .on('zoom', event => {
      if (!this.alive) return;
      this.svg.querySelector('[data-graph-world]')?.setAttribute('transform', event.transform.toString());
    })
    .on('end', event => { this.activeMouse = false; if (this.alive) { this.cameraChanged.emit(event.transform); if (event.sourceEvent) this.finished.emit(); } });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.alive = false;
      this.observer?.disconnect();
      this.resizeObserver?.disconnect();
      select(this.svg).on('.zoom', null);
      select(this.svg).selectAll('[data-graph-node]').on('.drag', null);
      if (this.activeMouse) {
        select(window).on('.drag', null).on('.zoom', null);
        dragEnable(window);
      }
    });
  }
  private observer?: MutationObserver;
  ngAfterViewInit(): void {
    select(this.svg).call(this.camera).call(this.camera.transform, this.initialCamera()).on('dblclick.zoom', null);
    this.bindNodes();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(entries => {
        if (!this.alive) return;
        const { width, height } = entries[0].contentRect;
        if (width > 0 && height > 0) this.viewportChanged.emit({ width, height });
      });
      this.resizeObserver.observe(this.svg);
    }
    this.observer = new MutationObserver(() => this.bindNodes());
    this.observer.observe(this.svg, { childList: true, subtree: true });
  }
  private bindNodes(): void {
    if (!this.alive) return;
    const world = this.svg.querySelector<SVGGElement>('[data-graph-world]');
    if (!world) return;
    const behavior = drag<SVGGElement, unknown, GraphPoint>()
      .container(() => world)
      .clickDistance(5);
    const position = this.position();
    behavior.subject(function () { return { ...position(Number(this.dataset['graphNode'])) }; })
      .on('start', event => {
        if (!this.alive) return;
        if (event.sourceEvent.type === 'mousedown') this.activeMouse = true;
        this.started.emit();
      })
      .on('drag', event => {
        if (this.alive) this.moved.emit({ id: event.subject.id, x: event.x, y: event.y });
      })
      .on('end', () => { this.activeMouse = false; if (this.alive) this.finished.emit(); });
    for (const node of this.svg.querySelectorAll<SVGGElement>('[data-graph-node]')) {
      if (this.bound.has(node)) continue;
      this.bound.add(node);
      select(node).call(behavior);
    }
  }
  zoomBy(factor: number): void { select(this.svg).call(this.camera.scaleBy, factor); }
  reset(): void { select(this.svg).call(this.camera.transform, zoomIdentity); }
}
