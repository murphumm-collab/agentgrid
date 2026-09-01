import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const service = vi.hoisted(() => ({ protocolSnapshot: vi.fn() }));
vi.mock("@/lib/service", () => service);

import { GET } from "./route";

function request(query = "") {
  return new NextRequest(`https://grid.example/api/public/tasks/completed${query}`);
}

describe("completed-task pagination API", () => {
  beforeEach(() => service.protocolSnapshot.mockResolvedValue({ tasks: [], rewards: [] }));

  it("rejects unknown, duplicate and stale parameters with the stable error envelope", async () => {
    for (const [query, error] of [
      ["?unknown=value", "VALIDATION_ERROR"],
      ["?limit=10&limit=20", "QUERY_PARAMETER_DUPLICATE"],
      ["?cursor=missing-task", "COMPLETED_TASK_CURSOR_INVALID"],
    ]) {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error });
    }
    expect(service.protocolSnapshot).toHaveBeenCalledTimes(1);
  });

  it("returns the bounded first page when no cursor is supplied", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ tasks: [], nextCursor: null });
  });
});
