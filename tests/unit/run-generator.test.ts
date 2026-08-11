import { describe, expect, it } from "vitest";

import { ClassicalCorrelatedRunGenerator } from "../../src/simulation/RunGenerator";

function correlation(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) throw new Error("Correlation inputs must be non-empty peers.");
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = (left[index] ?? 0) - leftMean;
    const rightDelta = (right[index] ?? 0) - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  if (denominator === 0) throw new Error("Correlation inputs must vary.");
  return covariance / denominator;
}

describe("ClassicalCorrelatedRunGenerator", () => {
  it("reproduces the complete run configuration from its seed", () => {
    const generator = new ClassicalCorrelatedRunGenerator();

    const first = generator.generate(0x5eed_cafe);
    const replay = generator.generate(0x5eed_cafe);
    const other = generator.generate(0x5eed_caff);

    expect(replay).toEqual(first);
    expect(other).not.toEqual(first);
    expect(first.qSeed).not.toBe(first.dungeonSeed);
    expect(first.generator).toBe("classical-correlated-v1");
    for (const trait of Object.values(first.traits)) expect(trait).toBeGreaterThanOrEqual(0);
    for (const trait of Object.values(first.traits)) expect(trait).toBeLessThanOrEqual(1);
  });

  it("derives Q and world biases from shared latent run state", () => {
    const generator = new ClassicalCorrelatedRunGenerator();
    const runs = Array.from({ length: 192 }, (_, seed) => generator.generate(seed * 7_919 + 17));

    expect(correlation(
      runs.map(({ traits }) => traits.curiosity),
      runs.map(({ world }) => world.strangeDensity),
    )).toBeGreaterThan(0.9);
    expect(correlation(
      runs.map(({ traits }) => traits.caution),
      runs.map(({ world }) => world.hazardDensity),
    )).toBeGreaterThan(0.9);
    expect(correlation(
      runs.map(({ traits }) => traits.hunger),
      runs.map(({ world }) => world.foodAbundance),
    )).toBeLessThan(-0.9);
    expect(correlation(
      runs.map(({ traits }) => traits.compliance),
      runs.map(({ world }) => world.forwardPull),
    )).toBeGreaterThan(0.8);
  });
});
