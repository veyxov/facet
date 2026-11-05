export interface GraphPoint { id: number; x: number; y: number; }
export interface GraphLink { source_id: number; target_id: number; }

/** Deterministic force layout: stable identities, organic spacing, bounded work. */
export function organicPeopleLayout(ids: number[], links: GraphLink[], root: number): GraphPoint[] {
  const ordered = [...new Set(ids)].sort((a, b) => a - b);
  const depth = new Map<number, number>([[root, 0]]);
  for (let hop = 0; hop < 3; hop++) for (const edge of links) {
    if (depth.get(edge.source_id) === hop && !depth.has(edge.target_id)) depth.set(edge.target_id, hop + 1);
    if (depth.get(edge.target_id) === hop && !depth.has(edge.source_id)) depth.set(edge.source_id, hop + 1);
  }
  const nodes = ordered.map((id, index) => {
    const angle = index * 2.399963229728653 + (id % 17) * 0.04;
    const radius = id === root ? 0 : 170 + (depth.get(id) || 1) * 70;
    return { id, x: 450 + Math.cos(angle) * radius, y: 350 + Math.sin(angle) * radius, vx: 0, vy: 0 };
  });
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (let iteration = 0; iteration < 110; iteration++) {
    for (let left = 0; left < nodes.length; left++) for (let right = left + 1; right < nodes.length; right++) {
      const a = nodes[left], b = nodes[right];
      const dx = b.x - a.x, dy = b.y - a.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const force = Math.min(14, 18000 / (distance * distance));
      a.vx -= dx / distance * force; a.vy -= dy / distance * force;
      b.vx += dx / distance * force; b.vy += dy / distance * force;
    }
    for (const edge of links) {
      const a = byId.get(edge.source_id), b = byId.get(edge.target_id);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const force = (distance - 245) * 0.022;
      a.vx += dx / distance * force; a.vy += dy / distance * force;
      b.vx -= dx / distance * force; b.vy -= dy / distance * force;
    }
    for (const node of nodes) {
      if (node.id === root) { node.x = 450; node.y = 350; node.vx = 0; node.vy = 0; continue; }
      node.vx = (node.vx + (450 - node.x) * 0.001) * 0.78;
      node.vy = (node.vy + (350 - node.y) * 0.001) * 0.78;
      node.x += Math.max(-12, Math.min(12, node.vx));
      node.y += Math.max(-12, Math.min(12, node.vy));
    }
  }
  // Separate portrait/name cards, not just their anchor points.
  for (let pass = 0; pass < 24; pass++) {
    for (let left = 0; left < nodes.length; left++) for (let right = left + 1; right < nodes.length; right++) {
      const a = nodes[left], b = nodes[right];
      const dx = b.x - a.x, dy = b.y - a.y;
      const overlapX = 215 - Math.abs(dx), overlapY = 190 - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) continue;
      const horizontal = overlapX < overlapY;
      const amount = (horizontal ? overlapX : overlapY) + 0.5;
      const direction = (horizontal ? dx : dy) >= 0 ? 1 : -1;
      const aShare = a.id === root ? 0 : b.id === root ? 1 : 0.5;
      const bShare = 1 - aShare;
      if (horizontal) { a.x -= amount * direction * aShare; b.x += amount * direction * bShare; }
      else { a.y -= amount * direction * aShare; b.y += amount * direction * bShare; }
    }
  }
  return nodes;
}

/** Bounded, deterministic ambient drift; never changes saved or dragged positions. */
export function ambientPeoplePoint(point: GraphPoint, seconds: number): GraphPoint {
  const phase = point.id * 1.618;
  return { id: point.id, x: point.x + 3 * (Math.sin(seconds * 0.32 + phase) - Math.sin(phase)),
    y: point.y + 2 * (Math.cos(seconds * 0.27 + phase) - Math.cos(phase)) };
}
