import initSqlJs, { type SqlJsStatic } from 'sql.js'

let sqlPromise: Promise<SqlJsStatic> | null = null

/** Load SQLite (WebAssembly). In the browser the .wasm file is served next to the app. */
export function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      if (typeof window === 'undefined') {
        // Node (tests): let sql.js find its wasm in node_modules.
        return initSqlJs()
      }
      const wasmUrl = (await import('sql.js/dist/sql-wasm.wasm?url')).default
      return initSqlJs({ locateFile: () => wasmUrl })
    })()
  }
  return sqlPromise
}
