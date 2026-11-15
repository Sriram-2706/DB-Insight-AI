import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

let engine: Promise<SqlJsStatic> | undefined
export function getEngine() {
  engine ??= initSqlJs({ locateFile: () => wasmUrl })
  return engine
}

export type Column = { name: string; type: string; pk: boolean; notnull: boolean }
export type Relation = { from: string; toTable: string; to: string }
export type TableInfo = { name: string; type: 'table' | 'view'; count: number | null; columns: Column[]; relations: Relation[] }
export type Schema = TableInfo[]
export type QueryData = { columns: string[]; rows: Record<string, unknown>[] }

function readOnlyQueryText(sql: string): string {
  let code = ''
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch
      i++
      for (; i < sql.length; i++) {
        if (sql[i] === close) {
          if (close !== ']' && sql[i + 1] === close) { i++; continue }
          break
        }
      }
      if (i >= sql.length) throw new Error('The generated query contains an unfinished quoted value or identifier.')
      code += ' '
      continue
    }
    if (sql.startsWith('--', i) || sql.startsWith('/*', i)) throw new Error('SQL comments are not allowed.')
    if (ch === ';') throw new Error('Only one SQL statement is allowed.')
    code += ch
  }
  if (!/^(SELECT|WITH)\b/i.test(code.trim()) || /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|replace|vacuum|reindex|trigger)\b|\b(load_extension|readfile|writefile|edit|shell|fts3_tokenizer)\s*\(/i.test(code)) {
    throw new Error('Only a single read-only SELECT query is allowed.')
  }
  return code
}

export function inspect(db: Database): Schema {
  const objects = db.exec("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name")[0]?.values ?? []
  return objects.map(([rawName, rawType]) => {
    const name = String(rawName), type = rawType === 'view' ? 'view' : 'table'
    const escaped = name.replaceAll('"', '""')
    const columns = db.exec(`PRAGMA table_info("${escaped}")`)[0]?.values.map(v => ({ name: String(v[1]), type: String(v[2] || '—'), notnull: Boolean(v[3]), pk: Boolean(v[5]) })) ?? []
    const relations = db.exec(`PRAGMA foreign_key_list("${escaped}")`)[0]?.values.map(v => ({ from: String(v[3]), toTable: String(v[2]), to: String(v[4]) })) ?? []
    let count: number | null = null
    if (type === 'table') {
      try { count = Number(db.exec(`SELECT COUNT(*) FROM "${escaped}"`)[0]?.values[0]?.[0] ?? 0) } catch { count = null }
    }
    return { name, type, count, columns, relations }
  })
}

export function runQuery(db: Database, sql: string): QueryData {
  const normalized = sql.trim()
  readOnlyQueryText(normalized)
  // Prepare first so SQLite itself checks names and syntax against the loaded file.
  let statement
  try { statement = db.prepare(normalized) } catch { throw new Error('The generated query does not match this database schema.') }
  statement.free()
  // query_only is set as soon as a database is loaded. The outer limit also caps
  // a model response that contains a larger or missing inner LIMIT.
  const result = db.exec(`SELECT * FROM (${normalized}) AS "__dbi_result" LIMIT 200`)[0]
  if (!result) return { columns: [], rows: [] }
  return { columns: result.columns, rows: result.values.map(values => Object.fromEntries(result.columns.map((c, i) => [c, values[i]]))) }
}

export function createSample(SQL: SqlJsStatic): Database {
  const db = new SQL.Database()
  db.run(`PRAGMA foreign_keys = ON;
    CREATE TABLE customers (customer_id INTEGER PRIMARY KEY, customer_name TEXT NOT NULL, city TEXT, joined_on TEXT);
    CREATE TABLE products (product_id INTEGER PRIMARY KEY, product_name TEXT NOT NULL, category TEXT, unit_price REAL NOT NULL);
    CREATE TABLE orders (order_id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(customer_id), order_date TEXT NOT NULL, status TEXT);
    CREATE TABLE order_items (item_id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(order_id), product_id INTEGER NOT NULL REFERENCES products(product_id), quantity INTEGER NOT NULL, unit_price REAL NOT NULL);`)
  const cities = ['Brooklyn', 'Portland', 'Austin', 'Chicago', 'Oakland', 'Denver', 'Seattle', 'Queens']
  const first = ['Avery', 'Jordan', 'Morgan', 'Riley', 'Casey', 'Taylor', 'Quinn', 'Reese', 'Drew', 'Emery', 'Rowan', 'Kai', 'Sage', 'Arden', 'Robin', 'Cameron', 'Jules', 'Skyler', 'Finley', 'Remy', 'Harper', 'Ellis', 'Parker', 'Noel']
  const last = ['Bennett', 'Rivera', 'Kim', 'Patel', 'Brooks', 'Chen', 'Foster', 'Reed', 'Price', 'Hayes', 'Morgan', 'Cole']
  const customers = db.prepare('INSERT INTO customers VALUES (?,?,?,?)')
  for (let i = 1; i <= 48; i++) customers.run([i, `${first[(i - 1) % first.length]} ${last[Math.floor((i - 1) / 2) % last.length]}`, cities[(i * 3) % cities.length], `2024-${String((i % 12) + 1).padStart(2, '0')}-${String((i * 7 % 27) + 1).padStart(2, '0')}`])
  customers.free()
  const products = [['Field Notes', 'Stationery', 14], ['Studio Mug', 'Home', 28], ['Canvas Tote', 'Accessories', 32], ['Desk Calendar', 'Stationery', 22], ['Linen Throw', 'Home', 88], ['Everyday Bottle', 'Accessories', 36], ['Ceramic Tray', 'Home', 46], ['Pocket Journal', 'Stationery', 12], ['Market Bag', 'Accessories', 54], ['Oak Desk Lamp', 'Lighting', 124], ['Task Light', 'Lighting', 78], ['Wool Cushion', 'Home', 64]] as const
  const productStmt = db.prepare('INSERT INTO products VALUES (?,?,?,?)')
  products.forEach((p, i) => productStmt.run([i + 1, ...p]))
  productStmt.free()
  const orderStmt = db.prepare('INSERT INTO orders VALUES (?,?,?,?)'), itemStmt = db.prepare('INSERT INTO order_items VALUES (?,?,?,?,?)')
  const statuses = ['shipped', 'shipped', 'shipped', 'processing', 'delivered']
  for (let i = 1; i <= 168; i++) {
    const month = ((i * 7 + Math.floor(i / 9)) % 12) + 1
    const day = ((i * 11) % 27) + 1
    orderStmt.run([i, ((i * 13 + Math.floor(i / 5)) % 48) + 1, `2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, statuses[i % statuses.length]])
    const count = (i % 3) + 1
    for (let j = 0; j < count; j++) {
      const product = products[(i * 5 + j * 7) % products.length]
      const productId = (i * 5 + j * 7) % products.length + 1
      const unit = product[2]
      itemStmt.run([null, i, productId, ((i + j) % 3) + 1, unit])
    }
  }
  orderStmt.free(); itemStmt.free()
  return db
}
