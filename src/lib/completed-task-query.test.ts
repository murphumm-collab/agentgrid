import { describe, expect, it } from "vitest";
import { completedTaskPageStart, parseCompletedTaskQuery } from "./completed-task-query";

describe("completed-task pagination contract", () => {
  it("parses only unique documented bounded parameters", () => {
    expect(parseCompletedTaskQuery(new URLSearchParams())).toEqual({ limit: 25 });
    expect(parseCompletedTaskQuery(new URLSearchParams("limit=100&cursor=task-1&category=Development&executionMode=COMPETITION")))
      .toEqual({ limit: 100, cursor: "task-1", category: "Development", executionMode: "COMPETITION" });
    expect(() => parseCompletedTaskQuery(new URLSearchParams("unknown=value"))).toThrow();
    expect(() => parseCompletedTaskQuery(new URLSearchParams("limit=10&limit=20"))).toThrow("QUERY_PARAMETER_DUPLICATE");
    expect(() => parseCompletedTaskQuery(new URLSearchParams("limit=101"))).toThrow();
    expect(() => parseCompletedTaskQuery(new URLSearchParams("cursor="))).toThrow();
  });

  it("rejects an unknown cursor instead of silently restarting page one", () => {
    expect(completedTaskPageStart(["task-3", "task-2", "task-1"])).toBe(0);
    expect(completedTaskPageStart(["task-3", "task-2", "task-1"], "task-2")).toBe(2);
    expect(completedTaskPageStart(["task-3", "task-2", "task-1"], "task-1")).toBe(3);
    expect(() => completedTaskPageStart(["task-3", "task-2"], "stale-task")).toThrow("COMPLETED_TASK_CURSOR_INVALID");
  });
});
