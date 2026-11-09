import { add, scale, sub, Vec3 } from '../core/math';

export const FOOTPLATE_THICKNESS = 0.008;

/** Soften the outline corners without moving the mounting points or sole plane. */
export function roundFootOutline(outline: Vec3[]): Vec3[] {
  return outline.flatMap((corner, index) => {
    const previous = outline[(index + outline.length - 1) % outline.length];
    const next = outline[(index + 1) % outline.length];
    const start = add(corner, scale(sub(previous, corner), 0.14));
    const end = add(corner, scale(sub(next, corner), 0.14));
    return [0, 0.25, 0.5, 0.75, 1].map((t) =>
      add(add(scale(start, (1 - t) ** 2), scale(corner, 2 * t * (1 - t))), scale(end, t ** 2))
    );
  });
}
