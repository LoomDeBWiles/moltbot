import { diagnosticLogger as diag } from "../logging/diagnostic.js";

const ACTIVE_CLI_RUNS = new Map<string, AbortController>();

export function registerCliRun(sessionId: string, controller: AbortController): void {
  if (!sessionId) return;
  ACTIVE_CLI_RUNS.set(sessionId, controller);
  diag.debug(`cli run registered: sessionId=${sessionId} totalActive=${ACTIVE_CLI_RUNS.size}`);
}

export function unregisterCliRun(sessionId: string, controller: AbortController): void {
  if (!sessionId) return;
  // Only delete if this is still the registered controller (guard against replace-then-old-unregister race).
  if (ACTIVE_CLI_RUNS.get(sessionId) === controller) {
    ACTIVE_CLI_RUNS.delete(sessionId);
    diag.debug(`cli run cleared: sessionId=${sessionId} totalActive=${ACTIVE_CLI_RUNS.size}`);
  }
}

export function abortCliRun(sessionId: string): boolean {
  const controller = ACTIVE_CLI_RUNS.get(sessionId);
  if (!controller) {
    diag.debug(`cli abort failed: sessionId=${sessionId} reason=no_active_run`);
    return false;
  }
  diag.debug(`aborting cli run: sessionId=${sessionId}`);
  controller.abort();
  return true;
}

export function isCliRunActive(sessionId: string): boolean {
  return ACTIVE_CLI_RUNS.has(sessionId);
}
