import { describe, expect, it } from "vitest";
import { maintenanceJob } from "./maintenance-job";
const input = { chainId: 97, registry: "0xabc", taskId: "1", state: 8, tester: "0xdef", workRound: 1, artifactHash: "0x123", startedAt: 1000n, approved: [true, false, false, false], now: 1000n + 90n * 86400n };
describe("canonical maintenance scheduling", () => {
  it("schedules only the earliest unfinished checkpoint even after a 90-day outage", () => {
    expect(maintenanceJob(input)?.payload.checkpoint).toBe(1);
    expect(maintenanceJob({ ...input, approved: [true, true, false, false] })?.payload.checkpoint).toBe(2);
    expect(maintenanceJob({ ...input, approved: [true, true, true, false] })?.payload.checkpoint).toBe(3);
    expect(maintenanceJob({ ...input, approved: [true, true, true, true] })).toBeNull();
  });
  it("keeps the same identity across hours, concurrent schedulers and restarts", () => {
    expect(maintenanceJob(input)?.id).toBe(maintenanceJob({ ...input, now: input.now + 3600n })?.id);
  });
  it("isolates repaired rounds and checks due boundaries using chain time", () => {
    expect(maintenanceJob(input)?.id).not.toBe(maintenanceJob({ ...input, workRound: 2 })?.id);
    expect(maintenanceJob({ ...input, now: 1000n + 7n * 86400n - 1n })).toBeNull();
    expect(maintenanceJob({ ...input, now: 1000n + 7n * 86400n })?.payload.checkpoint).toBe(1);
    expect(maintenanceJob({ ...input, state: 6 })).toBeNull();
    expect(maintenanceJob({ ...input, startedAt: 0n })).toBeNull();
  });
  it("recreates the original identity after a checkpoint approval is reorged", () => {
    const original = maintenanceJob(input);
    expect(maintenanceJob({ ...input, approved: [true, true, false, false] })?.id).not.toBe(original?.id);
    expect(maintenanceJob(input)?.id).toBe(original?.id);
  });
});
