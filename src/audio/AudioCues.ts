import type { GameEvent } from "../simulation/types";

export class AudioCues {
  private context: AudioContext | null = null;

  unlock(): void {
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") void this.context.resume();
  }

  play(event: GameEvent): void {
    if (!this.context) return;
    if (event.type === "decision") return;
    if (event.type === "call") {
      this.tone(620, 0.09, "sine", 0.04, 760);
      this.tone(820, 0.12, "sine", 0.025, 920, 0.07);
      return;
    }
    if (event.type === "care") {
      this.tone(170, 0.2, "sine", 0.035, 130);
      this.tone(255, 0.18, "triangle", 0.018, 210, 0.04);
      return;
    }
    if (event.type === "eat") {
      this.tone(440, 0.07, "triangle", 0.03, 620);
      this.tone(660, 0.09, "triangle", 0.025, 880, 0.055);
      return;
    }
    if (event.type === "rescue-up") {
      this.tone(310, 0.15, "sine", 0.03, 720);
      return;
    }
    if (event.type === "rescue-down") {
      this.tone(560, 0.14, "triangle", 0.03, 250);
      return;
    }
    if (event.type === "strange") {
      this.tone(260, 0.2, "sine", 0.03, 820);
      this.tone(530, 0.2, "square", 0.009, 180, 0.04);
      return;
    }
    if (event.type === "death") {
      this.tone(210, 0.48, "sawtooth", 0.035, 48);
      return;
    }
    if (event.type === "place") this.tone(event.label === "treat" ? 540 : 120, 0.07, "triangle", 0.018);
  }

  destroy(): void {
    if (this.context) void this.context.close();
    this.context = null;
  }

  private tone(
    startFrequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    endFrequency = startFrequency,
    delay = 0,
  ): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}
