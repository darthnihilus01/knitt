import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import type { AccountDatabase, DbStatement, SqlValue } from '../../apps/cloud/src/identity.ts';

export function cloudDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  const dir = new URL('../../apps/cloud/migrations/',import.meta.url);
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(file,dir),'utf8'));
  const prepare = (sql: string, params: SqlValue[] = []) => {
    const query = () => db.prepare(sql).all(...params);
    return {
      bind(...values: SqlValue[]) { return prepare(sql,values); },
      async first<T>() { return (query()[0] as T | undefined) ?? null; },
      async all<T>() { return {results:query() as T[]}; },
      async run() { return db.prepare(sql).run(...params); },
      query,
    };
  };
  const binding: AccountDatabase = {
    prepare,
    async batch(statements: DbStatement[]) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(s => ({results:(s as ReturnType<typeof prepare>).query()}));
        db.exec('COMMIT');
        return results;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  return {db,binding};
}
