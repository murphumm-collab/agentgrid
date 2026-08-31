export function operationalAlerts(
  database: Record<string, number | null>,
  queue: { executorQueued: number; testerQueued: number; evaluatorQueued: number; coordinatorQueued: number },
) {
  const alerts: string[] = [];
  const queued = queue.executorQueued + queue.testerQueued + queue.evaluatorQueued + queue.coordinatorQueued;
  if (queued >= 100) alerts.push("QUEUE_BACKLOG_HIGH");
  if ((database.pendingOutbox ?? 0) >= 100 || (database.pendingOutboxOldestSeconds ?? 0) >= 300) alerts.push("CHAIN_OUTBOX_STALLED");
  if ((database.unreadNotifications ?? 0) >= 1_000) alerts.push("NOTIFICATION_BACKLOG_HIGH");
  if ((database.expiredEvaluations ?? 0) > 0) alerts.push("TASK_EVALUATION_EXPIRY_BACKLOG");
  if (Object.hasOwn(database, "chainCursorAgeSeconds") && database.chainCursorAgeSeconds === null) alerts.push("CHAIN_INDEXER_NOT_STARTED");
  else if ((database.chainCursorAgeSeconds ?? 0) >= 120) alerts.push("CHAIN_INDEXER_STALLED");
  return alerts;
}
