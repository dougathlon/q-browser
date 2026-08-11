import Phaser from "phaser";
import { AudioCues } from "../audio/AudioCues";
import { TUNING } from "../config/tuning";
import { QGameSimulation } from "../simulation/QGameSimulation";
import {
  type DungeonChunk,
  type GameEvent,
  type GameSnapshot,
  type Point,
  type StrangeEffect,
  type Tile,
} from "../simulation/types";
import { QView } from "./QView";

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

const TILE = TUNING.tileSize;
const WORLD_WIDTH = TUNING.chunkWidth * TILE;

function tileCenter(point: Point): Point {
  return { x: (point.x + 0.5) * TILE, y: (point.y + 0.5) * TILE };
}

export class QScene extends Phaser.Scene {
  private readonly simulation: QGameSimulation;
  private readonly onSnapshot: (snapshot: Readonly<GameSnapshot>) => void;
  private readonly audio: AudioCues;
  private terrainGraphics?: Phaser.GameObjects.Graphics;
  private objectGraphics?: Phaser.GameObjects.Graphics;
  private debugGraphics?: Phaser.GameObjects.Graphics;
  private fxLayer?: Phaser.GameObjects.Container;
  private qView?: QView;
  private renderedDungeonVersion = -1;
  private pointerWorld: Point = { x: 0, y: 0 };
  private pointerTile: Point = { x: 0, y: 0 };
  private pointerOverQ = false;
  private lastInvalidAt = -10;

  constructor(
    simulation: QGameSimulation,
    onSnapshot: (snapshot: Readonly<GameSnapshot>) => void,
    audio: AudioCues,
  ) {
    super("q-cave");
    this.simulation = simulation;
    this.onSnapshot = onSnapshot;
    this.audio = audio;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x07100f);
    this.terrainGraphics = this.add.graphics();
    this.objectGraphics = this.add.graphics();
    this.qView = new QView(this);
    this.debugGraphics = this.add.graphics();
    this.fxLayer = this.add.container(0, 0);
    this.input.setDefaultCursor("crosshair");
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => this.updatePointer(pointer));
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => this.handlePointerDown(pointer));
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.updateCamera(true));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.qView?.destroy());
    this.renderDungeon(this.simulation.getDungeon().getChunks());
    this.updateCamera(true);
  }

  update(time: number, delta: number): void {
    this.simulation.update(delta / 1_000);
    const snapshot = this.simulation.getSnapshot();
    if (snapshot.debug.dungeonVersion !== this.renderedDungeonVersion) {
      this.renderDungeon(this.simulation.getDungeon().getChunks());
    }
    this.updatePointer(this.input.activePointer);
    this.drawWorldObjects(snapshot, time / 1_000);
    const qCenter = {
      x: snapshot.q.position.x * TILE,
      y: snapshot.q.position.y * TILE,
    };
    this.qView?.update(
      snapshot,
      qCenter.x,
      qCenter.y,
      time / 1_000,
      snapshot.q.held ? this.pointerWorld : null,
    );
    this.qView?.getContainer().setDepth(40);
    this.debugGraphics?.setDepth(60);
    this.updateCamera(false);
    for (const event of this.simulation.drainEvents()) {
      this.audio.play(event);
      this.spawnEventFx(event);
    }
    this.onSnapshot(snapshot);
  }

  private renderDungeon(chunks: readonly DungeonChunk[]): void {
    const graphics = this.terrainGraphics;
    if (!graphics) return;
    graphics.clear();
    graphics.setDepth(0);
    for (const chunk of chunks) {
      for (const row of chunk.tiles) {
        for (const tile of row) this.drawTile(graphics, tile);
      }
    }
    this.renderedDungeonVersion = this.simulation.getDungeon().getVersion();
  }

  private drawTile(graphics: Phaser.GameObjects.Graphics, tile: Tile): void {
    const x = tile.x * TILE;
    const y = tile.y * TILE;
    if (tile.kind === "wall") {
      const colors = [0x101916, 0x121d19, 0x15201b, 0x0f1715];
      graphics.fillStyle(colors[tile.variant % colors.length] ?? 0x111a17, 1);
      graphics.fillRect(x, y, TILE + 1, TILE + 1);
      graphics.lineStyle(1, 0x26372f, 0.44);
      graphics.strokeRoundedRect(x + 3, y + 4, TILE - 7, TILE - 8, 8);
      graphics.fillStyle(tile.variant % 3 === 0 ? 0x45674b : 0x263d32, 0.28);
      graphics.fillCircle(x + 9 + (tile.variant % 4) * 8, y + 12 + (tile.variant % 3) * 9, 2 + (tile.variant % 2));
      if (tile.variant === 6) {
        graphics.fillStyle(0x6ca999, 0.42);
        graphics.fillTriangle(x + 35, y + 8, x + 30, y + 22, x + 40, y + 20);
      }
      return;
    }

    const floorColors = [0x29342e, 0x2c3831, 0x26322d, 0x303b34];
    graphics.fillStyle(floorColors[tile.variant % floorColors.length] ?? 0x29342e, 1);
    graphics.fillRect(x, y, TILE + 1, TILE + 1);
    graphics.lineStyle(1, 0x49584a, 0.16);
    graphics.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
    graphics.fillStyle(0x93a77a, tile.variant % 4 === 0 ? 0.16 : 0.07);
    graphics.fillEllipse(x + 10 + (tile.variant % 5) * 6, y + 13 + (tile.variant % 3) * 8, 5, 3);

    if (tile.kind === "pit") this.drawPit(graphics, x, y);
    else if (tile.kind === "damage") this.drawDamage(graphics, x, y);
    else if (tile.kind === "food") this.drawFood(graphics, x, y);
    else if (tile.kind === "strange" && tile.strangeEffect) this.drawStrange(graphics, x, y, tile.strangeEffect);
  }

  private drawPit(graphics: Phaser.GameObjects.Graphics, x: number, y: number): void {
    graphics.fillStyle(0x050807, 0.96);
    graphics.fillEllipse(x + TILE / 2, y + TILE / 2 + 2, 37, 31);
    graphics.lineStyle(3, 0x647065, 0.5);
    graphics.strokeEllipse(x + TILE / 2, y + TILE / 2 + 1, 39, 33);
    graphics.lineStyle(2, 0x0b100e, 0.8);
    graphics.strokeEllipse(x + TILE / 2, y + TILE / 2 + 1, 27, 21);
    graphics.fillStyle(0xaac1a2, 0.18);
    graphics.fillEllipse(x + 18, y + 15, 8, 3);
  }

  private drawDamage(graphics: Phaser.GameObjects.Graphics, x: number, y: number): void {
    graphics.fillStyle(0x5f261f, 0.5);
    graphics.fillRoundedRect(x + 5, y + 5, TILE - 10, TILE - 10, 9);
    graphics.lineStyle(4, 0xff744d, 0.9);
    graphics.beginPath();
    graphics.moveTo(x + 7, y + 31);
    graphics.lineTo(x + 20, y + 23);
    graphics.lineTo(x + 15, y + 10);
    graphics.moveTo(x + 20, y + 23);
    graphics.lineTo(x + 34, y + 16);
    graphics.lineTo(x + 41, y + 7);
    graphics.moveTo(x + 23, y + 24);
    graphics.lineTo(x + 34, y + 39);
    graphics.strokePath();
    graphics.fillStyle(0xffc056, 0.8);
    graphics.fillCircle(x + 20, y + 23, 3);
  }

  private drawFood(graphics: Phaser.GameObjects.Graphics, x: number, y: number): void {
    graphics.fillStyle(0xe9b85f, 1);
    graphics.fillCircle(x + 23, y + 24, 8);
    graphics.fillStyle(0xffd986, 1);
    graphics.fillCircle(x + 20, y + 20, 5);
    graphics.fillStyle(0xc85970, 1);
    graphics.fillCircle(x + 27, y + 20, 4);
    graphics.lineStyle(2, 0x8dbc72, 1);
    graphics.lineBetween(x + 24, y + 15, x + 27, y + 10);
    graphics.fillStyle(0x8dbc72, 1);
    graphics.fillEllipse(x + 30, y + 11, 8, 4);
  }

  private drawStrange(graphics: Phaser.GameObjects.Graphics, x: number, y: number, effect: StrangeEffect): void {
    const colors: Record<StrangeEffect, number> = {
      reverse: 0xe478c6,
      frenzy: 0xffcc54,
      fascination: 0x67d8df,
      calm: 0x82a8ff,
      hunger: 0xff7d6b,
      defiance: 0xb58bff,
    };
    const color = colors[effect];
    graphics.fillStyle(color, 0.13);
    graphics.fillCircle(x + 24, y + 24, 18);
    graphics.lineStyle(2.5, color, 0.95);
    if (effect === "reverse") {
      graphics.lineBetween(x + 10, y + 18, x + 38, y + 18);
      graphics.lineBetween(x + 10, y + 18, x + 17, y + 12);
      graphics.lineBetween(x + 38, y + 30, x + 10, y + 30);
      graphics.lineBetween(x + 38, y + 30, x + 31, y + 36);
    } else if (effect === "frenzy") {
      graphics.beginPath();
      graphics.moveTo(x + 12, y + 34);
      graphics.lineTo(x + 19, y + 12);
      graphics.lineTo(x + 25, y + 31);
      graphics.lineTo(x + 34, y + 14);
      graphics.lineTo(x + 38, y + 34);
      graphics.strokePath();
    } else if (effect === "fascination") {
      graphics.strokeCircle(x + 24, y + 24, 13);
      graphics.strokeCircle(x + 24, y + 24, 6);
      graphics.fillStyle(color, 1);
      graphics.fillCircle(x + 24, y + 24, 2.5);
    } else if (effect === "calm") {
      graphics.strokeEllipse(x + 24, y + 20, 27, 13);
      graphics.strokeEllipse(x + 24, y + 28, 22, 10);
    } else if (effect === "hunger") {
      graphics.strokeCircle(x + 24, y + 25, 11);
      graphics.beginPath();
      graphics.arc(x + 24, y + 25, 5, 0.2, 2.9);
      graphics.strokePath();
      graphics.lineBetween(x + 22, y + 13, x + 27, y + 8);
    } else {
      graphics.lineBetween(x + 13, y + 13, x + 35, y + 35);
      graphics.lineBetween(x + 35, y + 13, x + 13, y + 35);
      graphics.strokeCircle(x + 24, y + 24, 15);
    }
  }

  private drawWorldObjects(snapshot: Readonly<GameSnapshot>, time: number): void {
    const graphics = this.objectGraphics;
    const debug = this.debugGraphics;
    if (!graphics || !debug) return;
    graphics.clear();
    graphics.setDepth(25);

    for (const obstruction of snapshot.obstructions) {
      const center = tileCenter(obstruction);
      const alpha = Math.min(1, obstruction.remaining / 2);
      graphics.fillStyle(0x0a100e, 0.42 * alpha);
      graphics.fillEllipse(center.x, center.y + 13, 37, 13);
      graphics.fillStyle(0x657267, alpha);
      graphics.fillCircle(center.x - 9, center.y + 3, 10);
      graphics.fillStyle(0x79877a, alpha);
      graphics.fillCircle(center.x + 7, center.y + 2, 12);
      graphics.fillStyle(0x99a28c, alpha);
      graphics.fillCircle(center.x + 1, center.y - 7, 8);
      graphics.lineStyle(2, 0xc2c6a9, 0.32 * alpha);
      graphics.strokeCircle(center.x + 7, center.y + 2, 12);
    }

    for (const treat of snapshot.treats) {
      const center = tileCenter(treat);
      const bob = Math.sin(time * 5 + treat.x) * 3;
      const alpha = Math.min(1, treat.remaining / 1.5);
      graphics.fillStyle(0xffcf6d, alpha);
      graphics.fillCircle(center.x, center.y + bob, 8);
      graphics.fillStyle(0xff7b91, alpha);
      graphics.fillTriangle(center.x - 7, center.y + bob, center.x - 14, center.y - 5 + bob, center.x - 13, center.y + 7 + bob);
      graphics.fillTriangle(center.x + 7, center.y + bob, center.x + 14, center.y - 5 + bob, center.x + 13, center.y + 7 + bob);
      graphics.lineStyle(2, 0xffefbd, 0.7 * alpha);
      graphics.strokeCircle(center.x, center.y + bob, 8);
    }

    if (snapshot.call) {
      const center = tileCenter(snapshot.q.tile);
      const progress = 1 - snapshot.call.remaining / TUNING.callDurationSeconds;
      graphics.lineStyle(2, 0x9be8cf, 0.65 * (1 - progress));
      graphics.strokeCircle(center.x, center.y, 22 + progress * 55);
      graphics.strokeCircle(center.x, center.y, 31 + progress * 73);
    }

    this.drawCursorPreview(graphics, snapshot, time);
    this.drawDebug(debug, snapshot);
  }

  private drawCursorPreview(graphics: Phaser.GameObjects.Graphics, snapshot: Readonly<GameSnapshot>, time: number): void {
    if (!this.input.activePointer.active) return;
    if (!this.game.canvas.matches(":hover")) return;
    const validity = this.simulation.getActionValidity(this.pointerTile, this.pointerOverQ);
    const invalidFlash = time - this.lastInvalidAt < 0.22;
    const color = validity.valid && !invalidFlash ? 0x9be8cf : 0xff6f68;
    const center = tileCenter(this.pointerTile);
    graphics.lineStyle(2, color, 0.82);
    if (snapshot.selectedAction === "rescue" && snapshot.q.held) {
      const origin = tileCenter(snapshot.q.tile);
      const radius = TUNING.rescueRadiusTiles * TILE;
      graphics.beginPath();
      graphics.moveTo(origin.x, origin.y - radius);
      graphics.lineTo(origin.x + radius, origin.y);
      graphics.lineTo(origin.x, origin.y + radius);
      graphics.lineTo(origin.x - radius, origin.y);
      graphics.closePath();
      graphics.strokePath();
      graphics.strokeRoundedRect(center.x - 18, center.y - 18, 36, 36, 7);
      return;
    }
    if (snapshot.selectedAction === "call" || snapshot.selectedAction === "care" || snapshot.selectedAction === "rescue") {
      graphics.strokeCircle(this.pointerWorld.x, this.pointerWorld.y, this.pointerOverQ ? 27 : 18);
      if (snapshot.selectedAction === "care") {
        graphics.fillStyle(color, 0.72);
        graphics.fillCircle(this.pointerWorld.x - 5, this.pointerWorld.y - 2, 5);
        graphics.fillCircle(this.pointerWorld.x + 5, this.pointerWorld.y - 2, 5);
        graphics.fillTriangle(this.pointerWorld.x - 10, this.pointerWorld.y, this.pointerWorld.x + 10, this.pointerWorld.y, this.pointerWorld.x, this.pointerWorld.y + 12);
      }
      return;
    }
    graphics.fillStyle(color, 0.13);
    graphics.fillRoundedRect(center.x - 21, center.y - 21, 42, 42, 8);
    graphics.strokeRoundedRect(center.x - 21, center.y - 21, 42, 42, 8);
    if (snapshot.selectedAction === "treat") {
      graphics.fillStyle(color, 0.7);
      graphics.fillCircle(center.x, center.y, 7);
    } else {
      graphics.fillStyle(color, 0.55);
      graphics.fillCircle(center.x - 6, center.y + 2, 7);
      graphics.fillCircle(center.x + 5, center.y + 1, 8);
    }
  }

  private drawDebug(graphics: Phaser.GameObjects.Graphics, snapshot: Readonly<GameSnapshot>): void {
    graphics.clear();
    if (!snapshot.debug.enabled) return;
    graphics.setDepth(55);
    for (const chunk of this.simulation.getDungeon().getChunks()) {
      const y = chunk.index * TUNING.chunkHeight * TILE;
      graphics.lineStyle(2, 0x5ad8d0, 0.72);
      graphics.lineBetween(0, y, WORLD_WIDTH, y);
      graphics.lineStyle(1, 0x5ad8d0, 0.16);
      for (const point of chunk.safeRoute) {
        const center = tileCenter(point);
        graphics.fillStyle(0x63e6b6, 0.09);
        graphics.fillCircle(center.x, center.y, 4);
      }
    }
    for (const point of snapshot.q.perception.visible) {
      const center = tileCenter(point);
      graphics.fillStyle(0x76c9ff, 0.07);
      graphics.fillRect(center.x - TILE / 2 + 2, center.y - TILE / 2 + 2, TILE - 4, TILE - 4);
    }
    for (const hazard of snapshot.q.perception.hazards) {
      const center = tileCenter(hazard);
      graphics.lineStyle(3, 0xff5e57, 0.92);
      graphics.strokeCircle(center.x, center.y, 18);
    }
    for (const candidate of snapshot.q.candidateTraces) {
      if (candidate.path.length === 0) continue;
      graphics.lineStyle(candidate.selected ? 4 : 1.5, candidate.selected ? 0xffe070 : 0x9a87ff, candidate.selected ? 0.95 : 0.2 + candidate.weight * 0.5);
      graphics.beginPath();
      const start = tileCenter(snapshot.q.tile);
      graphics.moveTo(start.x, start.y);
      for (const point of candidate.path) {
        const center = tileCenter(point);
        graphics.lineTo(center.x, center.y);
      }
      graphics.strokePath();
    }
    if (snapshot.q.target) {
      const target = tileCenter(snapshot.q.target);
      graphics.lineStyle(3, 0xffe070, 0.9);
      graphics.strokeCircle(target.x, target.y, 13);
      graphics.lineBetween(target.x - 18, target.y, target.x + 18, target.y);
      graphics.lineBetween(target.x, target.y - 18, target.x, target.y + 18);
    }
  }

  private updatePointer(pointer: Phaser.Input.Pointer): void {
    const camera = this.cameras.main;
    const worldPoint = camera.getWorldPoint(pointer.x, pointer.y);
    this.pointerWorld = { x: worldPoint.x, y: worldPoint.y };
    this.pointerTile = { x: Math.floor(worldPoint.x / TILE), y: Math.floor(worldPoint.y / TILE) };
    const snapshot = this.simulation.getSnapshot();
    const qX = snapshot.q.held ? this.pointerWorld.x : snapshot.q.position.x * TILE;
    const qY = snapshot.q.held ? this.pointerWorld.y : snapshot.q.position.y * TILE;
    this.pointerOverQ = Phaser.Math.Distance.Between(qX, qY, worldPoint.x, worldPoint.y) <= 34;
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    this.audio.unlock();
    this.updatePointer(pointer);
    const result = this.simulation.useSelected(this.pointerTile, this.pointerOverQ);
    if (!result.success) {
      this.lastInvalidAt = this.time.now / 1_000;
      this.cameras.main.shake(70, 0.0015);
    }
  }

  private updateCamera(immediate: boolean): void {
    const camera = this.cameras.main;
    const snapshot = this.simulation.getSnapshot();
    const qX = snapshot.q.position.x * TILE;
    const qY = snapshot.q.position.y * TILE;
    const targetX = camera.width >= WORLD_WIDTH
      ? (WORLD_WIDTH - camera.width) / 2
      : Phaser.Math.Clamp(qX - camera.width / 2, 0, WORLD_WIDTH - camera.width);
    const targetY = qY - camera.height * 0.63;
    if (immediate) {
      camera.setScroll(targetX, targetY);
      return;
    }
    camera.scrollX = Phaser.Math.Linear(camera.scrollX, targetX, 0.09);
    camera.scrollY = Phaser.Math.Linear(camera.scrollY, targetY, 0.075);
  }

  private spawnEventFx(event: GameEvent): void {
    if (!this.fxLayer || event.type === "decision" || event.type === "place") return;
    const center = tileCenter(event.at);
    const symbols: Partial<Record<GameEvent["type"], string>> = {
      eat: "✦",
      call: "!",
      care: "♥",
      "rescue-up": "↑",
      "rescue-down": "↓",
      strange: "◇",
      death: "×",
    };
    const symbol = symbols[event.type] ?? "·";
    const text = this.add.text(center.x, center.y - 28, symbol, {
      fontFamily: "Georgia, serif",
      fontSize: event.type === "death" ? "40px" : "24px",
      fontStyle: "bold",
      color: event.type === "death" ? "#ff6f68" : event.type === "care" ? "#ff93ad" : "#fff0b5",
      stroke: "#09100e",
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(80);
    this.fxLayer.add(text);
    this.tweens.add({
      targets: text,
      y: text.y - 34,
      alpha: 0,
      scale: 1.35,
      duration: event.type === "death" ? 950 : 620,
      ease: "Cubic.Out",
      onComplete: () => text.destroy(),
    });
    if (event.type === "death") this.cameras.main.shake(180, 0.008);
  }
}
