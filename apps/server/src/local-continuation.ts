import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, copyFileSync, existsSync, mkdirSync, openSync, readSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { boundedRecords, describeConversation, transcriptPath } from '../../../packages/adapters/src/conversation.ts';
import type { ConversationDescriptor } from '../../../packages/adapters/src/conversation.ts';
import { importConversation } from '../../../packages/adapters/src/handoff.ts';
import type { Conversation } from '../../../packages/adapters/src/handoff.ts';
import { messageText, splitText } from '../../../packages/adapters/src/transcript.ts';
import { redact } from '../../../packages/adapters/src/hooks.ts';
import { eventSchema } from '../../../packages/contracts/src/events.ts';
import type { StoredEvent } from '../../../packages/contracts/src/events.ts';
import type { MemoryStore } from '../../../packages/memory/src/store.ts';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type FileState = { inode: number; size: number; modified: number; changed: number };
export type LocalBoundary =
  | { kind: 'transcript'; endOffset: number; fingerprint: string; file: FileState }
  | { kind: 'index'; file: FileState; wal: FileState | null };
type Pin = {
  conversation: Conversation; indexConversation: Conversation; descriptor: ConversationDescriptor;
  boundary: LocalBoundary; events: StoredEvent[]; status: 'indexing' | 'ready' | 'error';
  error?: string; capturedAt: string;
};
function fileState(path: string): FileState {
  const stat = statSync(path);
  return { inode: stat.ino, size: stat.size, modified: stat.mtimeMs, changed: stat.ctimeMs };
}
function fingerprint(path: string, end: number) {
  const fd = openSync(path, 'r');
  try {
    const first = Buffer.alloc(Math.min(end, 4096)), last = Buffer.alloc(Math.min(end, 4096));
    readSync(fd, first, 0, first.length, 0);
    readSync(fd, last, 0, last.length, Math.max(0, end - last.length));
    return digest([first.toString('base64'), last.toString('base64')]);
  } finally { closeSync(fd); }
}
function lastCompleteOffset(path: string, size: number) {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(size, 64 * 1024));
    let end = size;
    while (end > 0) {
      const start = Math.max(0, end - buffer.length), count = readSync(fd, buffer, 0, end - start, start);
      const newline = buffer.subarray(0, count).lastIndexOf(10);
      if (newline >= 0) return start + newline + 1;
      end = start;
    }
    return 0;
  } finally { closeSync(fd); }
}
export class LocalContinuations {
  private jobs = new Map<string, ReturnType<typeof setTimeout>>();
  private closed = false;
  private store: MemoryStore;
  private directory: string;
  private repoId: string;
  constructor(store: MemoryStore, directory: string, repoId: string) {
    this.store = store; this.directory = directory; this.repoId = repoId;
  }
  ticket(c: Conversation): LocalBoundary {
    const path = transcriptPath(c);
    if (existsSync(path)) {
      const delta = relative(realpathSync(c.root), realpathSync(path));
      if (delta === '..' || delta.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(delta))
        throw new Error('Source unavailable outside source history directory');
      const file = fileState(path), endOffset = lastCompleteOffset(path, file.size);
      return { kind: 'transcript', endOffset, fingerprint: fingerprint(path, endOffset), file };
    }
    const index = join(c.root, 'conversation_summaries.db');
    if ((c.client ?? 'antigravity') !== 'antigravity' || !existsSync(index))
      throw new Error('Source unavailable. Refresh the picker.');
    return { kind: 'index', file: fileState(index), wal: existsSync(index + '-wal') ? fileState(index + '-wal') : null };
  }
  private validate(c: Conversation, boundary: LocalBoundary) {
    try {
      if (digest(this.ticket(c)) !== digest(boundary)) throw new Error('changed');
    } catch {
      throw new Error('Selected source changed or is unavailable. Refresh the picker; no other chat was loaded.');
    }
  }
  private freeze(c: Conversation, boundary: LocalBoundary, sourceId: string): Conversation {
    // A live file's sampled hash cannot guarantee immutable older evidence.
    // Freeze bytes once (filesystem copy-on-write where available), then index
    // the private snapshot rather than reading the live source after selection.
    const parent = join(this.directory, 'snapshots', sourceId);
    const directory = join(parent, digest(boundary)), temporary = directory + '.tmp-' + randomUUID();
    const transcript = join(directory, 'transcript.jsonl');
    if (existsSync(directory)) return { ...c, root: directory, ...(boundary.kind === 'transcript' ? { transcript } : { transcript: undefined }) };
    mkdirSync(temporary, { recursive: true, mode: 0o700 });
    try {
      if (boundary.kind === 'transcript') {
        const target = join(temporary, 'transcript.jsonl');
        copyFileSync(transcriptPath(c), target, constants.COPYFILE_FICLONE);
        chmodSync(target, 0o600);
      } else {
        // Copy only the selected conversation in one consistent SQLite read
        // transaction, including committed WAL content; never cache other chats.
        const input = new DatabaseSync(join(c.root, 'conversation_summaries.db'), { readOnly: true });
        const outputPath = join(temporary, 'conversation_summaries.db'), output = new DatabaseSync(outputPath);
        try {
          input.exec('BEGIN');
          output.exec('CREATE TABLE conversations_fts(conversation_id TEXT,chunk_index INTEGER,user_body TEXT,agent_body TEXT); BEGIN');
          const insert = output.prepare('INSERT INTO conversations_fts VALUES(?,?,?,?)');
          for (const row of input.prepare('SELECT chunk_index,user_body,agent_body FROM conversations_fts WHERE conversation_id=? ORDER BY CAST(chunk_index AS INTEGER)').iterate(c.id))
            insert.run(c.id, row.chunk_index, row.user_body, row.agent_body);
          output.exec('COMMIT'); input.exec('COMMIT');
        } finally { input.close(); output.close(); }
        chmodSync(outputPath, 0o600);
      }
      this.validate(c, boundary);
      renameSync(temporary, directory);
    } catch (error) { rmSync(temporary, { recursive: true, force: true }); throw error; }
    return { ...c, root: directory, ...(boundary.kind === 'transcript' ? { transcript } : { transcript: undefined }) };
  }
  select(c: Conversation, listed?: LocalBoundary) {
    if (listed) this.validate(c, listed);
    const boundary = this.ticket(c), descriptor = describeConversation(c);
    const featureId = 'local:' + descriptor.sourceId + ':' + digest(boundary).slice(0, 20), snapshotStarted = performance.now();
    let pin = this.store.localPin<Pin>(this.repoId, featureId);
    if (!pin) {
      const frozen = this.freeze(c, boundary, descriptor.sourceId);
      const scope = { repoId: this.repoId, featureId, ...(c.branch ? { branch: c.branch } : {}) }, events: StoredEvent[] = [];
      const add = (text: string, source: string, eventId: string) => events.push({
        ...eventSchema.parse({ ...scope, sessionId: c.id, kind: 'progress', content: text, source, eventId }), receivedAt: new Date().toISOString(),
      });
      if (boundary.kind === 'transcript') {
        for (const { row, byte } of boundedRecords(transcriptPath(frozen), boundary.endOffset, 2 * 1024 * 1024)) {
          const text = messageText(row); if (!text) continue;
          splitText(redact(text)).forEach((content, index) => add(content,
            (c.client ?? 'antigravity') + ':transcript:line-byte=' + byte + ':part=' + index,
            digest({ client: c.client ?? 'antigravity', scope, sessionId: c.id, byte, index, content })));
        }
      } else {
        const db = new DatabaseSync(join(frozen.root, 'conversation_summaries.db'), { readOnly: true });
        try {
          for (const row of db.prepare('SELECT chunk_index,user_body,agent_body FROM conversations_fts WHERE conversation_id=? ORDER BY CAST(chunk_index AS INTEGER) DESC LIMIT 20').all(c.id).reverse()) {
            for (const [field, role] of [['user_body', 'user'], ['agent_body', 'assistant']]) {
              if (typeof row[field] !== 'string' || !row[field]) continue;
              splitText(redact(role + ': ' + row[field])).forEach((content, index) => {
                const sourceRef = 'antigravity:index:chunk=' + row.chunk_index + ':' + field + ':part=' + index;
                add(content, sourceRef, digest({ scope, session: c.id, sourceRef, content }));
              });
            }
          }
        } finally { db.close(); }
      }
      if (!events.length) throw new Error('No supported recent messages are available in the selected source. No other chat was loaded.');
      let budget = 0;
      const recent = events.reverse().filter(e => { budget += JSON.stringify(e).length; return budget <= 12000; });
      if (!recent.length) recent.push(events[0]);
      pin = { conversation: c, indexConversation: frozen, descriptor, boundary, events: recent, status: 'indexing', capturedAt: new Date().toISOString() };
    } else { pin.descriptor = descriptor; }
    this.store.saveLocalPin(this.repoId, featureId, pin);
    this.schedule(featureId);
    const snapshotMs = performance.now() - snapshotStarted, contextStarted = performance.now(), context = this.context(featureId);
    return { featureId, descriptor, context, timings: { selectedHistoryMs: snapshotMs, contextAssemblyMs: performance.now() - contextStarted } };
  }
  context(featureId: string) {
    const pin = this.store.localPin<Pin>(this.repoId, featureId);
    if (!pin) throw new Error('Local source selection unavailable');
    this.schedule(featureId);
    const total = Math.max(pin.events.length,this.store.countEvents(this.repoId, featureId));
    return { events: pin.events, total, order: 'newest_first', truncated: pin.status !== 'ready' || pin.events.length < total,
      contentTrust: 'untrusted_reference', source: pin.descriptor, boundary: pin.boundary, checkpoint: null,
      checkpointStatus: 'No checkpoint available; these are recent source messages.', indexing: { status: pin.status, ...(pin.error ? { error: pin.error } : {}) }, capturedAt: pin.capturedAt };
  }
  evidence(featureId: string, eventId: string) {
    const pin = this.store.localPin<Pin>(this.repoId,featureId);
    return pin?.events.find(event=>event.eventId===eventId) ?? this.store.evidence(this.repoId,eventId);
  }
  private schedule(featureId: string) {
    if (this.closed || this.jobs.has(featureId)) return;
    const pin = this.store.localPin<Pin>(this.repoId, featureId);
    if (!pin || pin.status !== 'indexing') return;
    const timer = setTimeout(() => { this.jobs.delete(featureId); this.step(featureId); }, 10);
    timer.unref(); this.jobs.set(featureId, timer);
  }
  private step(featureId: string) {
    if (this.closed) return;
    const pin = this.store.localPin<Pin>(this.repoId, featureId);
    if (!pin || pin.status !== 'indexing') return;
    try {
      const report = importConversation({ conversation: pin.indexConversation, repoId: this.repoId, featureId,
        directory: join(this.directory, digest(featureId)), store: this.store, maxBatches: 1, maxRecords: 50,
        ...(pin.boundary.kind === 'transcript' ? { endOffset: pin.boundary.endOffset } : {}) });
      if (!report.remainingBytes) pin.status = 'ready';
      else if (report.incomplete) throw new Error('Snapshot contains an unsupported incomplete record');
    } catch (error) { pin.status = 'error'; pin.error = error instanceof Error ? error.message : 'Source indexing failed'; }
    this.store.saveLocalPin(this.repoId, featureId, pin); this.schedule(featureId);
  }
  async drain(featureId: string) {
    while (!this.closed && this.store.localPin<Pin>(this.repoId, featureId)?.status === 'indexing') await new Promise(resolve => setTimeout(resolve, 15));
  }
  close() { this.closed = true; for (const timer of this.jobs.values()) clearTimeout(timer); this.jobs.clear(); }
}
