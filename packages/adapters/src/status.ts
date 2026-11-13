import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { sessionKeySchema } from "../../contracts/src/conversations.ts";
import { openQueue } from "./hooks.ts";
export const captureStatusSchema = z.object({
  session: sessionKeySchema,
  lastCaptureAt: z.string().nullable(),
  lastDeliveryAt: z.string().nullable(),
  pending: z.number().int().nonnegative(),
  lastErrorCode: z.enum(["CAPTURE_FAILED", "DELIVERY_PENDING"]).nullable(),
});
export type CaptureStatus = z.infer<typeof captureStatusSchema>;
export function recordCaptureStatus(
  directory: string,
  input: CaptureStatus,
): void {
  const status = captureStatusSchema.parse(input),
    queue = openQueue(directory),
    id = JSON.stringify(status.session);
  try {
    queue.exec(
      "CREATE TABLE IF NOT EXISTS capture_status(id TEXT PRIMARY KEY,payload TEXT NOT NULL)",
    );
    const row = queue
      .prepare("SELECT payload FROM capture_status WHERE id=?")
      .get(id);
    const old = row
      ? captureStatusSchema.parse(JSON.parse(String(row.payload)))
      : null;
    const value = {
      ...status,
      lastCaptureAt: status.lastCaptureAt ?? old?.lastCaptureAt ?? null,
      lastDeliveryAt: status.lastDeliveryAt ?? old?.lastDeliveryAt ?? null,
    };
    queue
      .prepare(
        "INSERT INTO capture_status VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      )
      .run(id, JSON.stringify(value));
  } finally {
    queue.close();
  }
}
export function readCaptureStatuses(directory: string): CaptureStatus[] {
  const path = join(directory, "queue.sqlite");
  if (!existsSync(path)) return [];
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (
      !db
        .prepare("SELECT name FROM sqlite_master WHERE name='capture_status'")
        .get()
    )
      return [];
    return db
      .prepare("SELECT payload FROM capture_status ORDER BY id")
      .all()
      .map((row) => captureStatusSchema.parse(JSON.parse(String(row.payload))));
  } finally {
    db.close();
  }
}
export function pendingForSession(
  directory: string,
  session: CaptureStatus["session"],
): number {
  const path = join(directory, "queue.sqlite");
  if (!existsSync(path)) return 0;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return Number(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM pending WHERE json_extract(payload,'$.repoId')=? AND json_extract(payload,'$.sessionId')=? AND json_extract(payload,'$.source') LIKE ?",
        )
        .get(session.repoId, session.nativeSessionId, session.client + ":%")!.n,
    );
  } finally {
    db.close();
  }
}
