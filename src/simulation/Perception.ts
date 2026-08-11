import { TUNING } from "../config/tuning";
import { Dungeon } from "./Dungeon";
import {
  DIRECTIONS,
  DIRECTION_VECTORS,
  manhattan,
  pointKey,
  type PerceptionSnapshot,
  type Point,
  type TimedWorldObject,
} from "./types";

export interface PerceptionResult extends PerceptionSnapshot {
  distanceByKey: Map<string, number>;
  pathByKey: Map<string, Point[]>;
}

export function perceive(
  dungeon: Dungeon,
  origin: Point,
  obstructions: readonly TimedWorldObject[],
  treats: readonly TimedWorldObject[],
): PerceptionResult {
  const blocked = new Set(obstructions.map(pointKey));
  const treatsByKey = new Map(treats.map((treat) => [pointKey(treat), treat]));
  const queue: Point[] = [{ ...origin }];
  const distanceByKey = new Map([[pointKey(origin), 0]]);
  const pathByKey = new Map<string, Point[]>([[pointKey(origin), []]]);
  const visible: Point[] = [];
  const hazards: PerceptionResult["hazards"] = [];
  const food: PerceptionResult["food"] = [];
  const strange: PerceptionResult["strange"] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const currentKey = pointKey(current);
    const distance = distanceByKey.get(currentKey) ?? 0;
    const tile = dungeon.getTile(current);
    if (!tile) continue;
    visible.push({ ...current });

    if (tile.kind === "pit" || tile.kind === "damage") {
      hazards.push({ ...current, kind: tile.kind, distance });
      continue;
    }
    if (tile.kind === "food") food.push({ ...current, kind: "food", distance });
    if (treatsByKey.has(currentKey)) food.push({ ...current, kind: "treat", distance });
    if (tile.kind === "strange" && tile.strangeEffect) {
      strange.push({ ...current, effect: tile.strangeEffect, distance });
    }
    if (distance >= TUNING.perceptionRadius) continue;

    for (const direction of DIRECTIONS) {
      const vector = DIRECTION_VECTORS[direction];
      const next = { x: current.x + vector.x, y: current.y + vector.y };
      const nextKey = pointKey(next);
      if (distanceByKey.has(nextKey) || blocked.has(nextKey) || !dungeon.isWalkable(next)) continue;
      if (manhattan(origin, next) > TUNING.perceptionRadius) continue;
      distanceByKey.set(nextKey, distance + 1);
      pathByKey.set(nextKey, [...(pathByKey.get(currentKey) ?? []), next]);
      queue.push(next);
    }
  }

  hazards.sort((a, b) => a.distance - b.distance || pointKey(a).localeCompare(pointKey(b)));
  food.sort((a, b) => a.distance - b.distance || pointKey(a).localeCompare(pointKey(b)));
  strange.sort((a, b) => a.distance - b.distance || pointKey(a).localeCompare(pointKey(b)));
  const stimuli: string[] = [];
  if (hazards.length > 0) stimuli.push(`${hazards.length} visible hazard${hazards.length === 1 ? "" : "s"}`);
  if (food.length > 0) stimuli.push(`${food[0]?.kind ?? "food"} at ${food[0]?.distance ?? "?"} tiles`);
  if (strange.length > 0) stimuli.push(`${strange[0]?.effect ?? "strange"} tile nearby`);

  return { visible, hazards, food, strange, stimuli, distanceByKey, pathByKey };
}
