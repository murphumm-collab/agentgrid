import { expect, it } from "vitest";
import { simulateCoalition } from "./adversarial-economic-stress";
it("detects wallet rotation profit and bounds epoch issuance at 100/1000/10000 scale", () => {
  for (const size of [100, 1000, 10000]) {
    const result = simulateCoalition(size, true);
    expect(result.gross).toBeLessThanOrEqual(100000);
    expect(result.netProtocolProfit).toBeGreaterThan(0);
    expect(result.accepted).toBe(Math.min(500, size));
  }
  expect(simulateCoalition(5, false).firstRewards).toEqual([200, 140, 80, 40, 20]);
  expect(simulateCoalition(5, true).firstRewards).toEqual([200, 200, 200, 200, 200]);
  expect(simulateCoalition(5, true).netProtocolProfit).toBe(700);
});
