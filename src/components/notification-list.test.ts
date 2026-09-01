import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { NotificationRow } from "@/lib/store-postgres";
import { applyNotificationRead } from "./notification-list";

const first: NotificationRow = {
  id: "first",
  taskId: "42",
  kind: "TaskCreated",
  payload: {},
  readAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
};

describe("NotificationList", () => {
  it("marks only the selected notification as read without mutating the input", () => {
    const second = { ...first, id: "second" };
    const input = [first, second];
    const result = applyNotificationRead(input, "first", "2026-09-01T01:00:00.000Z");

    expect(result).toEqual([
      { ...first, readAt: "2026-09-01T01:00:00.000Z" },
      second,
    ]);
    expect(input[0]?.readAt).toBeNull();
    expect(result[1]).toBe(second);
  });

  it("keeps mutation failure visible and rejects duplicate in-flight writes", () => {
    const source = readFileSync(new URL("notification-list.tsx", import.meta.url), "utf8");
    expect(source).toContain("<ActionNotice");
    expect(source).toContain("inFlightIds.current.has(id)");
    expect(source).toContain("disabled={pendingIds.has(item.id)}");
    expect(source).toContain("aria-busy={pendingIds.has(item.id)}");
    expect(source).toContain('tone: "error"');
  });
});
