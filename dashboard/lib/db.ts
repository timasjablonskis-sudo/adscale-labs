/**
 * dashboard/lib/db.ts
 * SQLite connection singleton for the Next.js dashboard.
 *
 * Uses a global singleton pattern to prevent multiple connections from
 * being opened during Next.js Hot Module Replacement (HMR) in development.
 * In production, the module is only loaded once — but the singleton pattern
 * is still correct and costs nothing.
 *
 * The dashboard is read-heavy. The Express server handles all writes.
 * WAL mode (set by lib/database.js at startup) allows concurrent reads
 * even while the server is writing.
 */

import Database from 'better-sqlite3'
import path from 'path'

declare global {
  // eslint-disable-next-line no-var
  var _adscaleDb: Database.Database | undefined
}

const DB_PATH = process.env.DASHBOARD_DB_PATH
  ? path.resolve(process.cwd(), process.env.DASHBOARD_DB_PATH)
  : path.resolve(process.cwd(), '..', 'data', 'adscale.db')

// Reuse the existing connection in development (HMR-safe)
const db = global._adscaleDb ?? new Database(DB_PATH, { readonly: false })

if (process.env.NODE_ENV === 'development') {
  global._adscaleDb = db
}

export default db
