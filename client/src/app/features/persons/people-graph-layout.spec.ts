import { ambientPeoplePoint, organicPeopleLayout } from './people-graph-layout';

describe('organicPeopleLayout', () => {
  it('keeps the selected person anchored and produces stable finite positions', () => {
    const links = [{ source_id: 1, target_id: 2 }, { source_id: 2, target_id: 3 }, { source_id: 1, target_id: 4 }];
    const first = organicPeopleLayout([1, 2, 3, 4], links, 1);
    expect(first).toEqual(organicPeopleLayout([4, 3, 2, 1], links, 1));
    expect(first.find(point => point.id === 1)).toMatchObject({ x: 450, y: 350 });
    expect(first.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    for (const a of first) for (const b of first) if (a.id !== b.id) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(90);
  });
  it('keeps portrait/name cards separate in the six-person demo neighborhood', () => {
    const links = [{ source_id: 1, target_id: 3 }, { source_id: 2, target_id: 3 }, { source_id: 1, target_id: 2 }, { source_id: 1, target_id: 4 }, { source_id: 1, target_id: 5 }, { source_id: 3, target_id: 6 }];
    for (const root of [1, 2, 3, 4, 5, 6]) {
      const points = organicPeopleLayout([1, 2, 3, 4, 5, 6], links, root);
      expect(points.find(point => point.id === root)).toMatchObject({ x: 450, y: 350 });
      for (const a of points) for (const b of points) if (a.id !== b.id) {
        expect(Math.abs(a.x - b.x) >= 210 || Math.abs(a.y - b.y) >= 185).toBe(true);
      }
    }
  });

});

describe('ambientPeoplePoint', () => {
  it('starts without a jump and stays within six by four units indefinitely', () => {
    const point = { id: 7, x: 200, y: 400 };
    expect(ambientPeoplePoint(point, 0)).toEqual(point);
    for (const time of [1, 8, 60, 3600, 100000]) {
      const moved = ambientPeoplePoint(point, time);
      expect(Math.abs(moved.x - point.x)).toBeLessThanOrEqual(6);
      expect(Math.abs(moved.y - point.y)).toBeLessThanOrEqual(4);
      expect(moved).not.toEqual(point);
    }
    expect(point).toEqual({ id: 7, x: 200, y: 400 });
  });
});
