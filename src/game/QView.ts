import Phaser from "phaser";
import type {
  Direction,
  GameSnapshot,
  Point,
  PresentationState,
  QAppearance,
  QState,
} from "../simulation/types";

const TAU = Math.PI * 2;

interface Pose {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  shadowScale: number;
  shadowAlpha: number;
  step: number;
}

interface Gaze {
  x: number;
  y: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function shade(color: number, amount: number): number {
  const red = clamp(((color >> 16) & 0xff) + amount, 0, 255);
  const green = clamp(((color >> 8) & 0xff) + amount, 0, 255);
  const blue = clamp((color & 0xff) + amount, 0, 255);
  return (Math.round(red) << 16) | (Math.round(green) << 8) | Math.round(blue);
}

function directionVector(direction: Direction): Gaze {
  if (direction === "north") return { x: 0, y: -1 };
  if (direction === "east") return { x: 1, y: 0 };
  if (direction === "south") return { x: 0, y: 1 };
  return { x: -1, y: 0 };
}

function normalise(dx: number, dy: number): Gaze {
  const length = Math.hypot(dx, dy);
  return length > 0.001 ? { x: dx / length, y: dy / length } : { x: 0, y: 0 };
}

function statePose(state: PresentationState, time: number, stateTime: number): Pose {
  const breath = Math.sin(time * 2.35) * 0.025;
  const pose: Pose = {
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1 + breath,
    scaleY: 1 - breath,
    shadowScale: 1,
    shadowAlpha: 0.24,
    step: 0,
  };

  if (state === "walking") {
    pose.step = Math.sin(time * 10.5);
    const footfall = Math.abs(Math.sin(time * 10.5));
    pose.y = -footfall * 2.3;
    pose.rotation = pose.step * 0.025;
    pose.scaleX = 1 + footfall * 0.045;
    pose.scaleY = 1 - footfall * 0.035;
    pose.shadowScale = 1 - footfall * 0.08;
  } else if (state === "excited") {
    const hop = Math.abs(Math.sin(time * 8.6));
    pose.y = -3 - hop * 5;
    pose.rotation = Math.sin(time * 7.2) * 0.055;
    pose.scaleX = 0.96 + hop * 0.05;
    pose.scaleY = 1.08 - hop * 0.04;
    pose.shadowScale = 0.88 - hop * 0.13;
    pose.shadowAlpha = 0.19;
    pose.step = Math.sin(time * 12);
  } else if (state === "frightened") {
    pose.x = Math.sin(time * 44) * 1.35;
    pose.y = 2;
    pose.rotation = Math.sin(time * 37) * 0.035;
    pose.scaleX = 1.08;
    pose.scaleY = 0.9;
    pose.step = Math.sin(time * 27);
  } else if (state === "hungry") {
    pose.y = 1.5 + Math.sin(time * 3.1) * 0.5;
    pose.rotation = Math.sin(time * 2.1) * 0.035;
    pose.scaleX = 0.98;
    pose.scaleY = 0.97;
  } else if (state === "confused") {
    pose.y = 0.7;
    pose.rotation = Math.sin(time * 3.8) * 0.135;
    pose.scaleX = 1.01;
    pose.scaleY = 0.99;
  } else if (state === "patted") {
    const settle = Math.exp(-stateTime * 5);
    pose.y = 3 - settle * 2;
    pose.rotation = Math.sin(stateTime * 13) * 0.025 * settle;
    pose.scaleX = 1.16 - settle * 0.05;
    pose.scaleY = 0.82 + settle * 0.08;
    pose.shadowScale = 1.08;
  } else if (state === "called") {
    const pop = Math.exp(-stateTime * 5.5);
    pose.y = -2 - pop * 2;
    pose.rotation = Math.sin(stateTime * 16) * 0.08 * pop;
    pose.scaleX = 0.96 + pop * 0.04;
    pose.scaleY = 1.08 + pop * 0.08;
    pose.shadowScale = 0.92;
  } else if (state === "picked-up") {
    pose.x = Math.sin(time * 4.8) * 1.2;
    pose.y = -17 + Math.sin(time * 5.6) * 1.8;
    pose.rotation = Math.sin(time * 4.1) * 0.09;
    pose.scaleX = 0.96;
    pose.scaleY = 1.07;
    pose.shadowScale = 0.56;
    pose.shadowAlpha = 0.13;
    pose.step = Math.sin(time * 8.5);
  } else if (state === "dead") {
    const collapse = 1 - Math.exp(-stateTime * 7);
    pose.y = 3 + collapse * 5;
    pose.rotation = collapse * 0.16;
    pose.scaleX = 1 + collapse * 0.22;
    pose.scaleY = 1 - collapse * 0.38;
    pose.shadowScale = 1.15;
    pose.shadowAlpha = 0.3;
  }

  return pose;
}

/**
 * Snapshot-driven procedural view for Q. The simulation remains the sole source
 * of truth; this class retains only presentation-transition timing.
 */
export class QView {
  private readonly container: Phaser.GameObjects.Container;
  private readonly shadow: Phaser.GameObjects.Graphics;
  private readonly aura: Phaser.GameObjects.Graphics;
  private readonly body: Phaser.GameObjects.Graphics;
  private readonly face: Phaser.GameObjects.Graphics;
  private readonly effects: Phaser.GameObjects.Graphics;
  private presentation: PresentationState | null = null;
  private stateStartedAt = 0;
  private runSeed: number | null = null;

  constructor(scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0);
    this.shadow = scene.add.graphics();
    this.aura = scene.add.graphics();
    this.body = scene.add.graphics();
    this.face = scene.add.graphics();
    this.effects = scene.add.graphics();
    this.container.add([this.shadow, this.aura, this.body, this.face, this.effects]);
    this.container.setName("q-view");
    this.container.setSize(52, 64);
    this.container.setDepth(120);
  }

  update(
    snapshot: Readonly<GameSnapshot>,
    displayX: number,
    displayY: number,
    timeSeconds: number,
    heldPointerWorld?: Point | null,
  ): void {
    const { q, run } = snapshot;
    if (this.runSeed !== run.runSeed) {
      this.runSeed = run.runSeed;
      this.presentation = null;
    }
    if (this.presentation !== q.presentation) {
      this.presentation = q.presentation;
      this.stateStartedAt = timeSeconds;
    }

    const held = q.held || q.presentation === "picked-up";
    const x = held && heldPointerWorld ? heldPointerWorld.x : displayX;
    const y = held && heldPointerWorld ? heldPointerWorld.y - 6 : displayY;
    this.container.setPosition(x, y);

    const stateTime = Math.max(0, timeSeconds - this.stateStartedAt);
    const pose = statePose(q.presentation, timeSeconds, stateTime);
    this.applyModifierMotion(q, pose, timeSeconds);
    this.drawShadow(pose, held);
    this.drawAura(q, run.appearance, timeSeconds, pose);
    this.drawCreature(q, run.appearance, run.qSeed, timeSeconds, pose);
    this.drawFace(q, run.appearance, timeSeconds, pose);
    this.drawEffects(q, run.appearance, run.qSeed, timeSeconds, stateTime, pose);
  }

  getContainer(): Phaser.GameObjects.Container {
    return this.container;
  }

  destroy(): void {
    this.container.destroy(true);
  }

  private applyModifierMotion(q: Readonly<QState>, pose: Pose, time: number): void {
    if (q.modifiers.some(({ type }) => type === "frenzy")) {
      pose.x += Math.sin(time * 52) * 0.75;
      pose.rotation += Math.sin(time * 39) * 0.025;
    }
    if (q.modifiers.some(({ type }) => type === "reverse")) {
      pose.rotation += Math.sin(time * 4.6) * 0.04;
    }
    if (q.modifiers.some(({ type }) => type === "calm")) {
      pose.x *= 0.3;
      pose.rotation *= 0.45;
    }
  }

  private drawShadow(pose: Readonly<Pose>, held: boolean): void {
    this.shadow.clear();
    this.shadow.setPosition(0, 0);
    const shadowY = held ? 17 : 15;
    this.shadow.fillStyle(0x071112, pose.shadowAlpha);
    this.shadow.fillEllipse(0, shadowY, 33 * pose.shadowScale, 9 * pose.shadowScale);
    if (held) {
      this.shadow.lineStyle(1.5, 0xc7fbef, 0.24);
      this.shadow.strokeEllipse(0, shadowY, 42, 15);
    }
  }

  private drawAura(q: Readonly<QState>, appearance: Readonly<QAppearance>, time: number, pose: Readonly<Pose>): void {
    this.aura.clear();
    const pulse = (Math.sin(time * 4.2) + 1) * 0.5;
    const modifierTypes = new Set(q.modifiers.map(({ type }) => type));
    if (modifierTypes.has("care")) {
      this.aura.lineStyle(2, appearance.accent, 0.2 + pulse * 0.13);
      this.aura.strokeEllipse(pose.x, pose.y, 43 + pulse * 3, 42 + pulse * 3);
    }
    if (modifierTypes.has("calm")) {
      this.aura.lineStyle(1.5, 0x8de9e1, 0.26 + pulse * 0.2);
      this.aura.strokeCircle(pose.x, pose.y, 22 + pulse * 4);
      this.aura.lineStyle(1, 0xd2fff5, 0.2);
      this.aura.strokeCircle(pose.x, pose.y, 27 + pulse * 5);
    }
    if (modifierTypes.has("fascination")) {
      for (let index = 0; index < 4; index += 1) {
        const angle = time * 1.4 + index * (TAU / 4);
        const radius = 24 + Math.sin(time * 3 + index) * 2;
        this.drawSparkle(
          this.aura,
          pose.x + Math.cos(angle) * radius,
          pose.y + Math.sin(angle) * radius * 0.72,
          2.4,
          0xaffff1,
          0.65,
        );
      }
    }
    if (modifierTypes.has("frenzy")) {
      this.aura.lineStyle(2, 0xff7697, 0.42);
      this.aura.beginPath();
      for (let index = 0; index <= 12; index += 1) {
        const angle = (index / 12) * TAU;
        const radius = index % 2 === 0 ? 24 + pulse * 2 : 29 + pulse * 2;
        const px = pose.x + Math.cos(angle) * radius;
        const py = pose.y + Math.sin(angle) * radius * 0.78;
        if (index === 0) this.aura.moveTo(px, py);
        else this.aura.lineTo(px, py);
      }
      this.aura.strokePath();
    }
    if (modifierTypes.has("reverse")) {
      const slide = (time * 10) % 7;
      this.aura.lineStyle(2, 0xc3a0ff, 0.55);
      this.aura.beginPath();
      this.aura.moveTo(-25 + slide, -3);
      this.aura.lineTo(-20 + slide, -8);
      this.aura.lineTo(-15 + slide, -3);
      this.aura.moveTo(25 - slide, 5);
      this.aura.lineTo(20 - slide, 10);
      this.aura.lineTo(15 - slide, 5);
      this.aura.strokePath();
    }
    if (modifierTypes.has("defiance")) {
      this.aura.lineStyle(2, 0xdb5b84, 0.55);
      this.aura.beginPath();
      this.aura.moveTo(-23, -14);
      this.aura.lineTo(-28, -19);
      this.aura.lineTo(-22, -21);
      this.aura.moveTo(23, -14);
      this.aura.lineTo(28, -19);
      this.aura.lineTo(22, -21);
      this.aura.strokePath();
    }
  }

  private drawCreature(
    q: Readonly<QState>,
    appearance: Readonly<QAppearance>,
    qSeed: number,
    time: number,
    pose: Readonly<Pose>,
  ): void {
    this.body.clear();
    this.body.setPosition(pose.x, pose.y);
    this.body.setRotation(pose.rotation);
    this.body.setScale(pose.scaleX, pose.scaleY);

    const bodyDark = shade(appearance.body, -52);
    const bodyLight = shade(appearance.body, 28);
    const accentDark = shade(appearance.accent, -38);
    const facing = directionVector(q.direction);
    const legSwing = pose.step * 2.1;
    const droop = q.presentation === "hungry" || q.presentation === "frightened" ? 3 : 0;
    const perk = q.presentation === "called" || q.presentation === "excited" ? -3 : 0;

    this.body.fillStyle(bodyDark, 0.95);
    this.body.fillEllipse(-9 - legSwing, 13, 11, 7);
    this.body.fillEllipse(9 + legSwing, 13, 11, 7);
    if (q.presentation === "picked-up") {
      this.body.fillEllipse(-8 + Math.sin(time * 8) * 2, 18, 7, 11);
      this.body.fillEllipse(8 - Math.sin(time * 8) * 2, 18, 7, 11);
    }

    this.drawEars(this.body, appearance, bodyDark, bodyLight, droop + perk, q.presentation);

    this.body.fillStyle(bodyDark, 1);
    this.body.fillEllipse(0, 1.5, 39, 37);
    this.body.fillStyle(appearance.body, 1);
    this.body.fillEllipse(0, 0, 36, 35);
    this.body.fillStyle(bodyLight, 0.55);
    this.body.fillEllipse(-7, -9, 14, 8);
    this.body.lineStyle(1.5, shade(appearance.body, -70), 0.68);
    this.body.strokeEllipse(0, 0, 36, 35);

    const bellyX = facing.x * 1.2;
    const bellyY = 6 + Math.max(0, facing.y) * 1.5;
    this.body.fillStyle(appearance.belly, 0.92);
    this.body.fillEllipse(bellyX, bellyY, 23, 18);
    this.body.lineStyle(1, shade(appearance.belly, -28), 0.34);
    this.body.strokeEllipse(bellyX, bellyY, 23, 18);

    const armY = q.presentation === "picked-up" ? -2 : q.presentation === "patted" ? 6 : 3;
    const armSpread = q.presentation === "picked-up" ? 19 : q.presentation === "patted" ? 17 : 16;
    this.body.fillStyle(bodyDark, 0.96);
    this.body.fillEllipse(-armSpread, armY, 7, q.presentation === "picked-up" ? 12 : 9);
    this.body.fillEllipse(armSpread, armY, 7, q.presentation === "picked-up" ? 12 : 9);
    this.body.fillStyle(appearance.body, 1);
    this.body.fillEllipse(-armSpread, armY - 1, 5, q.presentation === "picked-up" ? 10 : 7);
    this.body.fillEllipse(armSpread, armY - 1, 5, q.presentation === "picked-up" ? 10 : 7);

    const marking = Math.abs(qSeed) % 3;
    this.body.fillStyle(appearance.accent, 0.72);
    if (marking === 0) {
      this.body.fillCircle(-13, 7, 2.1);
      this.body.fillCircle(13, 7, 2.1);
    } else if (marking === 1) {
      this.body.fillTriangle(-3, 13, 0, 9, 3, 13);
    } else {
      this.body.fillEllipse(0, 13, 9, 2.5);
    }
    if (q.modifiers.some(({ type }) => type === "defiance")) {
      this.body.fillStyle(accentDark, 0.82);
      this.body.fillTriangle(-4, -15, 0, -20, 4, -15);
    }
  }

  private drawEars(
    graphics: Phaser.GameObjects.Graphics,
    appearance: Readonly<QAppearance>,
    bodyDark: number,
    bodyLight: number,
    offset: number,
    state: PresentationState,
  ): void {
    if (appearance.earStyle === "ears") {
      const spread = state === "frightened" ? 2 : state === "called" ? -1 : 0;
      graphics.fillStyle(bodyDark, 1);
      graphics.fillTriangle(-16 - spread, -10 + offset, -12 - spread, -27 + offset, -5, -13);
      graphics.fillTriangle(16 + spread, -10 + offset, 12 + spread, -27 + offset, 5, -13);
      graphics.fillStyle(appearance.body, 1);
      graphics.fillTriangle(-14 - spread, -11 + offset, -11 - spread, -23 + offset, -7, -13);
      graphics.fillTriangle(14 + spread, -11 + offset, 11 + spread, -23 + offset, 7, -13);
      graphics.fillStyle(appearance.accent, 0.55);
      graphics.fillTriangle(-12.5 - spread, -13 + offset, -11 - spread, -20 + offset, -8.5, -13);
      graphics.fillTriangle(12.5 + spread, -13 + offset, 11 + spread, -20 + offset, 8.5, -13);
    } else if (appearance.earStyle === "antennae") {
      graphics.lineStyle(3.5, bodyDark, 1);
      graphics.beginPath();
      graphics.moveTo(-8, -13);
      graphics.lineTo(-12, -24 + offset);
      graphics.moveTo(8, -13);
      graphics.lineTo(12, -24 + offset);
      graphics.strokePath();
      graphics.lineStyle(2, appearance.body, 1);
      graphics.beginPath();
      graphics.moveTo(-8, -13);
      graphics.lineTo(-12, -24 + offset);
      graphics.moveTo(8, -13);
      graphics.lineTo(12, -24 + offset);
      graphics.strokePath();
      graphics.fillStyle(appearance.accent, 1);
      graphics.fillCircle(-12, -25 + offset, state === "called" ? 4.2 : 3.4);
      graphics.fillCircle(12, -25 + offset, state === "called" ? 4.2 : 3.4);
      graphics.fillStyle(bodyLight, 0.72);
      graphics.fillCircle(-13, -26 + offset, 1.1);
      graphics.fillCircle(11, -26 + offset, 1.1);
    } else {
      graphics.fillStyle(bodyDark, 1);
      graphics.fillCircle(-12, -14 + offset * 0.55, 7);
      graphics.fillCircle(12, -14 + offset * 0.55, 7);
      graphics.fillStyle(appearance.body, 1);
      graphics.fillCircle(-12, -15 + offset * 0.55, 5.5);
      graphics.fillCircle(12, -15 + offset * 0.55, 5.5);
      graphics.fillStyle(appearance.accent, 0.5);
      graphics.fillCircle(-12, -15 + offset * 0.55, 2.3);
      graphics.fillCircle(12, -15 + offset * 0.55, 2.3);
    }
  }

  private drawFace(
    q: Readonly<QState>,
    appearance: Readonly<QAppearance>,
    time: number,
    pose: Readonly<Pose>,
  ): void {
    this.face.clear();
    this.face.setPosition(pose.x, pose.y);
    this.face.setRotation(pose.rotation);
    this.face.setScale(pose.scaleX, pose.scaleY);

    const gaze = this.resolveGaze(q, time);
    const faceShift = directionVector(q.direction);
    const centreX = faceShift.x * 2.2;
    const centreY = -5 + faceShift.y * 1.3;
    const spacing = appearance.eyeSpacing * 0.5;
    const blinkCycle = (time + (Math.abs(this.runSeed ?? 0) % 19) * 0.11) % 4.4;
    const blinking = blinkCycle > 4.18 && q.presentation !== "frightened" && q.presentation !== "called";
    const closedHappy = q.presentation === "patted" || q.presentation === "dead";
    const eyeRadius = q.presentation === "frightened" ? 5 : q.presentation === "called" ? 4.6 : 4.1;
    const fascination = q.modifiers.some(({ type }) => type === "fascination");
    const eyeDark = 0x182128;

    if (q.presentation === "dead") {
      this.face.lineStyle(2.2, eyeDark, 0.9);
      this.drawXEye(this.face, centreX - spacing, centreY, 3.2);
      this.drawXEye(this.face, centreX + spacing, centreY, 3.2);
    } else if (closedHappy || blinking) {
      this.face.lineStyle(2.2, eyeDark, 1);
      this.face.beginPath();
      this.face.moveTo(centreX - spacing - 3, centreY);
      this.face.lineTo(centreX - spacing, centreY + (closedHappy ? 2 : 0));
      this.face.lineTo(centreX - spacing + 3, centreY);
      this.face.moveTo(centreX + spacing - 3, centreY);
      this.face.lineTo(centreX + spacing, centreY + (closedHappy ? 2 : 0));
      this.face.lineTo(centreX + spacing + 3, centreY);
      this.face.strokePath();
    } else {
      const leftScale = q.presentation === "confused" ? 0.82 : 1;
      const rightScale = q.presentation === "confused" ? 1.08 : 1;
      this.face.fillStyle(0xf9fff8, 0.97);
      this.face.fillEllipse(centreX - spacing, centreY, eyeRadius * 2 * leftScale, eyeRadius * 2.25 * leftScale);
      this.face.fillEllipse(centreX + spacing, centreY, eyeRadius * 2 * rightScale, eyeRadius * 2.25 * rightScale);
      this.face.lineStyle(1, shade(appearance.body, -76), 0.7);
      this.face.strokeEllipse(centreX - spacing, centreY, eyeRadius * 2 * leftScale, eyeRadius * 2.25 * leftScale);
      this.face.strokeEllipse(centreX + spacing, centreY, eyeRadius * 2 * rightScale, eyeRadius * 2.25 * rightScale);
      this.face.fillStyle(eyeDark, 1);
      const pupilRadius = fascination ? 2.6 : q.presentation === "frightened" ? 1.7 : 2.15;
      this.face.fillCircle(centreX - spacing + gaze.x * 1.6, centreY + gaze.y * 1.45, pupilRadius);
      this.face.fillCircle(centreX + spacing + gaze.x * 1.6, centreY + gaze.y * 1.45, pupilRadius);
      this.face.fillStyle(0xffffff, 0.96);
      this.face.fillCircle(centreX - spacing + gaze.x * 1.6 - 0.7, centreY + gaze.y * 1.45 - 0.9, 0.75);
      this.face.fillCircle(centreX + spacing + gaze.x * 1.6 - 0.7, centreY + gaze.y * 1.45 - 0.9, 0.75);
    }

    this.drawMouth(this.face, q.presentation, centreX, centreY + 8, time);
    if (q.presentation === "excited" || q.presentation === "patted" || q.presentation === "picked-up") {
      this.face.fillStyle(appearance.accent, 0.32);
      this.face.fillEllipse(centreX - spacing - 4.5, centreY + 6.2, 5.5, 2.8);
      this.face.fillEllipse(centreX + spacing + 4.5, centreY + 6.2, 5.5, 2.8);
    }
    if (q.modifiers.some(({ type }) => type === "defiance") && q.presentation !== "dead") {
      this.face.lineStyle(2, shade(appearance.accent, -50), 0.9);
      this.face.beginPath();
      this.face.moveTo(centreX - spacing - 3, centreY - 6);
      this.face.lineTo(centreX - spacing + 3, centreY - 4);
      this.face.moveTo(centreX + spacing - 3, centreY - 4);
      this.face.lineTo(centreX + spacing + 3, centreY - 6);
      this.face.strokePath();
    }
  }

  private resolveGaze(q: Readonly<QState>, time: number): Gaze {
    if (q.presentation === "confused") return normalise(Math.sin(time * 2.9), Math.cos(time * 2.1) * 0.5);
    if (q.target) return normalise(q.target.x - q.tile.x, q.target.y - q.tile.y);
    if (q.presentation === "frightened" && q.perception.hazards[0]) {
      const hazard = q.perception.hazards[0];
      return normalise(q.tile.x - hazard.x, q.tile.y - hazard.y);
    }
    if (q.presentation === "hungry" && q.perception.food[0]) {
      const food = q.perception.food[0];
      return normalise(food.x - q.tile.x, food.y - q.tile.y);
    }
    return directionVector(q.direction);
  }

  private drawMouth(
    graphics: Phaser.GameObjects.Graphics,
    state: PresentationState,
    x: number,
    y: number,
    time: number,
  ): void {
    const mouth = 0x34242b;
    graphics.lineStyle(1.8, mouth, 0.95);
    if (state === "excited") {
      graphics.fillStyle(mouth, 0.96);
      graphics.fillEllipse(x, y, 8, 6.5);
      graphics.fillStyle(0xff8da0, 0.95);
      graphics.fillEllipse(x, y + 2, 4.5, 2.2);
    } else if (state === "frightened" || state === "called") {
      graphics.strokeCircle(x, y, state === "frightened" ? 2.4 : 2);
    } else if (state === "hungry") {
      graphics.beginPath();
      graphics.moveTo(x - 4, y + 1);
      graphics.lineTo(x - 1, y - 1);
      graphics.lineTo(x + 2, y + 1);
      graphics.lineTo(x + 4, y - 1);
      graphics.strokePath();
    } else if (state === "confused") {
      graphics.beginPath();
      graphics.moveTo(x - 3, y + 1);
      graphics.lineTo(x + 3, y - 1);
      graphics.strokePath();
    } else if (state === "dead") {
      graphics.beginPath();
      graphics.moveTo(x - 3, y + 1);
      graphics.lineTo(x, y - 1);
      graphics.lineTo(x + 3, y + 1);
      graphics.strokePath();
    } else if (state === "walking") {
      graphics.beginPath();
      graphics.moveTo(x - 2.5, y);
      graphics.lineTo(x, y + 1.5 + Math.sin(time * 10) * 0.5);
      graphics.lineTo(x + 2.5, y);
      graphics.strokePath();
    } else {
      graphics.beginPath();
      graphics.moveTo(x - 3.5, y - 0.5);
      graphics.lineTo(x, y + 1.8);
      graphics.lineTo(x + 3.5, y - 0.5);
      graphics.strokePath();
    }
  }

  private drawEffects(
    q: Readonly<QState>,
    appearance: Readonly<QAppearance>,
    qSeed: number,
    time: number,
    stateTime: number,
    pose: Readonly<Pose>,
  ): void {
    this.effects.clear();
    const originX = pose.x;
    const originY = pose.y;
    if (q.presentation === "walking") {
      const dustPhase = (time * 4.8) % 1;
      this.effects.fillStyle(0xd8caa7, (1 - dustPhase) * 0.25);
      this.effects.fillCircle(originX - directionVector(q.direction).x * 12, originY + 14 + dustPhase * 2, 1.5 + dustPhase * 2);
    } else if (q.presentation === "excited") {
      for (let index = 0; index < 3; index += 1) {
        const phase = (time * 1.9 + index / 3 + (Math.abs(qSeed) % 11) * 0.03) % 1;
        const side = index % 2 === 0 ? -1 : 1;
        this.drawSparkle(
          this.effects,
          originX + side * (18 + phase * 6),
          originY + 5 - phase * 29,
          2.8 - phase,
          index === 1 ? appearance.accent : 0xffef9e,
          (1 - phase) * 0.85,
        );
      }
    } else if (q.presentation === "frightened") {
      const tremble = Math.sin(time * 18) * 1.4;
      this.effects.fillStyle(0x9deff2, 0.82);
      this.effects.fillTriangle(originX + 19 + tremble, originY - 12, originX + 23 + tremble, originY - 5, originX + 16 + tremble, originY - 5);
      this.effects.fillCircle(originX + 19.5 + tremble, originY - 5, 3.5);
      this.effects.lineStyle(2.2, 0xffd56f, 0.92);
      this.effects.beginPath();
      this.effects.moveTo(originX - 21, originY - 26);
      this.effects.lineTo(originX - 21, originY - 18);
      this.effects.strokePath();
      this.effects.fillStyle(0xffd56f, 0.92);
      this.effects.fillCircle(originX - 21, originY - 14.5, 1.6);
    } else if (q.presentation === "hungry") {
      const sniff = (Math.sin(time * 5) + 1) * 0.5;
      this.effects.lineStyle(1.4, appearance.accent, 0.35 + sniff * 0.35);
      this.effects.beginPath();
      this.effects.moveTo(originX + 17, originY - 7);
      this.effects.lineTo(originX + 22 + sniff * 2, originY - 9);
      this.effects.moveTo(originX + 17, originY - 3);
      this.effects.lineTo(originX + 23 + sniff * 3, originY - 3);
      this.effects.strokePath();
      this.effects.fillStyle(0xe2aa65, 0.86);
      this.effects.fillCircle(originX - 20, originY - 21, 3.2);
      this.effects.fillStyle(0xffdf8e, 0.9);
      this.effects.fillCircle(originX - 19, originY - 22, 1.1);
    } else if (q.presentation === "confused") {
      const bob = Math.sin(time * 3.5) * 1.2;
      this.effects.lineStyle(2.1, 0xc6b5ed, 0.82);
      this.effects.beginPath();
      this.effects.moveTo(originX + 18, originY - 24 + bob);
      this.effects.lineTo(originX + 22, originY - 28 + bob);
      this.effects.lineTo(originX + 27, originY - 25 + bob);
      this.effects.lineTo(originX + 24, originY - 20 + bob);
      this.effects.lineTo(originX + 22, originY - 18 + bob);
      this.effects.strokePath();
      this.effects.fillStyle(0xc6b5ed, 0.82);
      this.effects.fillCircle(originX + 21.5, originY - 13.5 + bob, 1.5);
    } else if (q.presentation === "patted") {
      const heartPhase = clamp(stateTime / 0.72, 0, 1);
      this.drawHeart(
        this.effects,
        originX + 9 + heartPhase * 8,
        originY - 22 - heartPhase * 13,
        5 - heartPhase * 1.2,
        appearance.accent,
        1 - heartPhase * 0.55,
      );
      this.effects.lineStyle(2.2, 0xffe6a6, 0.55 * (1 - heartPhase));
      this.effects.beginPath();
      this.effects.moveTo(originX - 7, originY - 25);
      this.effects.lineTo(originX - 2, originY - 29 - heartPhase * 2);
      this.effects.lineTo(originX + 3, originY - 25);
      this.effects.strokePath();
    } else if (q.presentation === "called") {
      const ring = clamp(stateTime / 0.55, 0, 1);
      this.effects.lineStyle(2, 0xffefb4, (1 - ring) * 0.88);
      this.effects.strokeCircle(originX, originY - 4, 22 + ring * 16);
      this.effects.lineStyle(1.3, appearance.accent, (1 - ring) * 0.6);
      this.effects.strokeCircle(originX, originY - 4, 27 + ring * 20);
      this.effects.fillStyle(0xffefb4, (1 - ring) * 0.9);
      this.effects.fillTriangle(originX - 3, originY - 30, originX + 3, originY - 30, originX, originY - 23);
    } else if (q.presentation === "picked-up") {
      const orbit = time * 2.5;
      this.effects.lineStyle(1.4, 0xbff9ec, 0.42);
      this.effects.strokeEllipse(originX, originY + 2, 47, 19);
      this.effects.fillStyle(0xcafff4, 0.62);
      for (let index = 0; index < 3; index += 1) {
        const angle = orbit + index * (TAU / 3);
        this.effects.fillCircle(originX + Math.cos(angle) * 23, originY + 2 + Math.sin(angle) * 9, 1.8);
      }
    } else if (q.presentation === "dead") {
      const wisp = clamp(stateTime / 1.2, 0, 1);
      this.effects.lineStyle(2, shade(appearance.belly, 18), (1 - wisp) * 0.48);
      this.effects.beginPath();
      this.effects.moveTo(originX - 5, originY - 16 - wisp * 10);
      this.effects.lineTo(originX - 9, originY - 22 - wisp * 16);
      this.effects.lineTo(originX - 4, originY - 28 - wisp * 19);
      this.effects.moveTo(originX + 5, originY - 15 - wisp * 8);
      this.effects.lineTo(originX + 10, originY - 21 - wisp * 13);
      this.effects.lineTo(originX + 7, originY - 26 - wisp * 18);
      this.effects.strokePath();
    }
  }

  private drawXEye(graphics: Phaser.GameObjects.Graphics, x: number, y: number, radius: number): void {
    graphics.beginPath();
    graphics.moveTo(x - radius, y - radius);
    graphics.lineTo(x + radius, y + radius);
    graphics.moveTo(x + radius, y - radius);
    graphics.lineTo(x - radius, y + radius);
    graphics.strokePath();
  }

  private drawSparkle(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    color: number,
    alpha: number,
  ): void {
    graphics.fillStyle(color, alpha);
    graphics.fillTriangle(x, y - radius, x - radius * 0.45, y, x + radius * 0.45, y);
    graphics.fillTriangle(x, y + radius, x - radius * 0.45, y, x + radius * 0.45, y);
    graphics.fillTriangle(x - radius, y, x, y - radius * 0.45, x, y + radius * 0.45);
    graphics.fillTriangle(x + radius, y, x, y - radius * 0.45, x, y + radius * 0.45);
  }

  private drawHeart(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    size: number,
    color: number,
    alpha: number,
  ): void {
    graphics.fillStyle(color, alpha);
    graphics.fillCircle(x - size * 0.27, y - size * 0.18, size * 0.34);
    graphics.fillCircle(x + size * 0.27, y - size * 0.18, size * 0.34);
    graphics.fillTriangle(x - size * 0.57, y - size * 0.05, x + size * 0.57, y - size * 0.05, x, y + size * 0.72);
  }
}
