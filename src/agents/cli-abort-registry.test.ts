import { describe, expect, it } from "vitest";

import { runCommandWithTimeout } from "../process/exec.js";
import {
  abortCliRun,
  isCliRunActive,
  registerCliRun,
  unregisterCliRun,
} from "./cli-abort-registry.js";

// End-to-end test: registering a controller, aborting it, and confirming the
// spawned child terminates via SIGTERM within the 2s grace window.
describe("cli-abort-registry", () => {
  it("aborts a spawned sleep and unregisters cleanly", async () => {
    const sessionId = "test-session-abort-1";
    const controller = new AbortController();
    registerCliRun(sessionId, controller);
    expect(isCliRunActive(sessionId)).toBe(true);

    const startedAt = Date.now();
    // Run node -e "setTimeout(()=>{}, 30000)" — portable across platforms
    // and guaranteed available wherever vitest runs.
    const runPromise = runCommandWithTimeout(["node", "-e", "setTimeout(()=>{},30000)"], {
      timeoutMs: 60_000,
      signal: controller.signal,
    }).finally(() => unregisterCliRun(sessionId, controller));

    setTimeout(() => {
      abortCliRun(sessionId);
    }, 500);

    const result = await runPromise;
    const elapsed = Date.now() - startedAt;

    // Must resolve well under the 30s sleep / 60s timeout — proves signal path, not timeout path.
    expect(elapsed).toBeLessThan(5_000);
    // Either SIGTERM observed on exit, or child.killed flag set.
    expect(result.signal === "SIGTERM" || result.killed === true).toBe(true);
    // Aborted processes do not exit with code 0.
    expect(result.code).toBeNull();
    // Registry is cleaned up after the `finally` unregister.
    expect(isCliRunActive(sessionId)).toBe(false);
  }, 10_000);

  it("returns false when aborting an unknown session", () => {
    expect(abortCliRun("nonexistent-session")).toBe(false);
  });
});
