import type { Schema, QueryData } from './db'

export type Answer = { sql: string; explanation: string; kind: 'table' | 'bar' | 'line'; title: string }
const q = (s: string) => `"${s.replaceAll('"', '""')}"`
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const tableScore = (t: string, terms: string[]) => terms.some(term => norm(t) === term || norm(t).includes(term))
const columnScore = (name: string, terms: string[]) => terms.findIndex(term => norm(name) === term) !== -1 ? 100 - terms.findIndex(term => norm(name) === term) : terms.reduce((n, term) => n + (norm(name).includes(term) ? 1 : 0), 0)
const col = (table: Schema[number], terms: string[], numeric = false) => {
  const candidates = table.columns.filter(c => !numeric || /int|real|num|dec|float|double/i.test(c.type)).sort((a,b) => columnScore(b.name,terms)-columnScore(a.name,terms))
  return candidates[0] && columnScore(candidates[0].name,terms) > 0 ? candidates[0] : undefined
}
const has = (s: string, ...terms: string[]) => terms.some(t => s.includes(t))
const find = (schema: Schema, terms: string[]) => schema.find(t => tableScore(t.name, terms))
const tableCountSql = (schema: Schema) => schema.filter(t => t.type === 'table').map(t => `SELECT '${t.name.replaceAll("'", "''")}' AS table_name, COUNT(*) AS records FROM ${q(t.name)}`).join(' UNION ALL ')

function joinPath(schema: Schema, start: Schema[number], target: Schema[number]): { joins: string[]; alias: Map<string, string> } | null {
  if (start.name === target.name) return { joins: [], alias: new Map([[start.name, 'a']]) }
  const queue: { table: Schema[number]; path: { from: string; toTable: string; fromColumn: string; toColumn: string }[] }[] = [{ table: start, path: [] }]
  const visited = new Set([start.name])
  while (queue.length) {
    const cur = queue.shift()!
    for (const t of schema) for (const fk of t.relations) {
      const edges = fk.toTable === t.name ? [] : []
      void edges
      const pairs: { from: string; toTable: string; fromColumn: string; toColumn: string }[] = []
      if (t.name === cur.table.name) pairs.push({ from: t.name, toTable: fk.toTable, fromColumn: fk.from, toColumn: fk.to })
      if (fk.toTable === cur.table.name) pairs.push({ from: cur.table.name, toTable: t.name, fromColumn: fk.to, toColumn: fk.from })
      for (const edge of pairs) {
        if (visited.has(edge.toTable)) continue
        const path = [...cur.path, edge]
        if (edge.toTable === target.name) {
          const alias = new Map([[start.name, 'a']]); path.forEach((p, i) => alias.set(p.toTable, `j${i+1}`))
          return { joins: path.map((p, i) => `JOIN ${q(p.toTable)} ${alias.get(p.toTable)} ON ${alias.get(p.from)}.${q(p.fromColumn)} = ${alias.get(p.toTable)}.${q(p.toColumn)}`), alias }
        }
        visited.add(edge.toTable); queue.push({ table: schema.find(x => x.name === edge.toTable)!, path })
      }
    }
  }
  // Infer conventional key relationships only when names are unambiguous.
  return null
}

function inferredPath(schema: Schema, start: Schema[number], target: Schema[number]) {
  const nodes = schema.map(t => t.name), edges: [string,string,string,string][] = []
  for (const a of schema) for (const b of schema) {
    if (a.name === b.name) continue
    const fk = col(a, [`${norm(b.name).replace(/s$/, '')}id`]) ?? a.columns.find(c => norm(c.name) === `${norm(b.name).replace(/s$/, '')}id`)
    const pk = b.columns.find(c => c.pk) ?? b.columns.find(c => norm(c.name) === `${norm(b.name).replace(/s$/, '')}id`)
    if (fk && pk) edges.push([a.name, b.name, fk.name, pk.name])
  }
  const queue: { at: string; path: typeof edges }[] = [{ at: start.name, path: [] }], seen = new Set([start.name])
  while (queue.length) {
    const { at, path } = queue.shift()!
    for (const e of edges) {
      const rev = e[1] === at ? [e[1],e[0],e[3],e[2]] as [string,string,string,string] : null
      const edge = e[0] === at ? e : rev
      if (!edge || seen.has(edge[1])) continue
      const next = [...path, edge]
      if (edge[1] === target.name) {
        const aliases = new Map([[start.name,'a']]); next.forEach((x,i)=>aliases.set(x[1],`j${i+1}`))
        return { joins: next.map(x=>`JOIN ${q(x[1])} ${aliases.get(x[1])} ON ${aliases.get(x[0])}.${q(x[2])} = ${aliases.get(x[1])}.${q(x[3])}`), alias: aliases }
      }
      seen.add(edge[1]); queue.push({at:edge[1],path:next})
    }
  }
  return null
}

export function generate(question: string, schema: Schema): Answer {
  const text = question.toLowerCase(), items = find(schema, ['orderitems','lineitems','orderdetails','purchaseitems','transactionitems'])
  const orders = find(schema, ['orders','sales','transactions','purchases'])
  const customers = find(schema, ['customers','clients','buyers','users'])
  const products = find(schema, ['products','items','inventory','services'])
  const amount = (t: Schema[number] | undefined) => t && col(t,['revenue','salesamount','totalamount','purchaseamount','amount','subtotal','total','price'],true)
  const quantity = items && col(items,['quantity','qty','units'],true)
  const value = items && (amount(items) || (quantity && col(items,['price','unitprice','cost','amount'],true)))
  const date = (t: Schema[number] | undefined) => t && col(t,['orderdate','saledate','transactiondate','purchasedate','createdat','date','month'])

  if (has(text,'each table','every table','per table','table count','total records','row count','record count','how many rows','how many records')) {
    const sql = tableCountSql(schema)
    if (!sql) throw new Error('There are no readable tables to count.')
    return { sql: `${sql} ORDER BY records DESC`, title: 'Records by table', kind: 'bar', explanation: 'Counts every row in each table. Views are excluded from the record totals.' }
  }

  if (has(text,'missing','null','empty value','incomplete')) {
    const nullable = schema.filter(t=>t.type==='table').flatMap(t=>t.columns.filter(c=>!c.notnull&&!c.pk).map(c=>({table:t.name,column:c.name})))
    if (!nullable.length) throw new Error('I could not find any nullable columns to inspect.')
    const sql = nullable.map(({table,column}) => `SELECT '${table.replaceAll("'","''")}' AS table_name, '${column.replaceAll("'","''")}' AS column_name, COUNT(*) AS missing_values FROM ${q(table)} WHERE ${q(column)} IS NULL`).join(' UNION ALL ')
    return { sql: `${sql} ORDER BY missing_values DESC`, title: 'Missing values', kind: 'bar', explanation: `Counts NULL values across ${nullable.length} nullable columns in all tables.` }
  }

  if (has(text,'month','monthly','trend','over time','by date')) {
    const t = orders && date(orders) ? orders : items
    const d = date(t), directAmount = amount(t)
    if (!t || !d || (!directAmount && !(items && quantity && value && orders))) throw new Error('I need a date column and a recognizable sales amount to build a monthly trend.')
    const time = `strftime('%Y-%m', a.${q(d.name)})`
    if (!directAmount && items && quantity && value && orders && t.name === orders.name) {
      const path = joinPath(schema, orders, items) ?? inferredPath(schema, orders, items)
      if (!path) throw new Error('I found dates and line item values but could not connect orders to line items.')
      const ia = path.alias.get(items.name)!
      return { sql: `SELECT ${time} AS month, SUM(${ia}.${q(quantity.name)} * ${ia}.${q(value.name)}) AS revenue FROM ${q(orders.name)} a ${path.joins.join(' ')} WHERE ${time} IS NOT NULL GROUP BY month ORDER BY month LIMIT 120`, title: 'Monthly revenue', kind: 'line', explanation: `Groups ${orders.name} by ${d.name} and totals linked line item sales.` }
    }
    const expr = directAmount ? `SUM(a.${q(directAmount.name)})` : `SUM(a.${q(quantity!.name)} * a.${q(value!.name)})`
    return { sql: `SELECT ${time} AS month, ${expr} AS revenue FROM ${q(t.name)} a WHERE ${time} IS NOT NULL GROUP BY month ORDER BY month LIMIT 120`, title: 'Monthly revenue', kind: 'line', explanation: `Groups ${t.name} by month using ${d.name} and totals its sales value.` }
  }

  if (has(text,'categor','category','segment')) {
    const t = products ?? schema.find(x => x.columns.some(c => /categor|type|segment/i.test(c.name)))
    const category = t && col(t,['category','segment','type','department'])
    if (!t || !category) throw new Error('I could not find a category-like column in this database.')
    const sql = `SELECT a.${q(category.name)} AS category, COUNT(*) AS records FROM ${q(t.name)} a GROUP BY a.${q(category.name)} ORDER BY records DESC LIMIT 20`
    return { sql, title: 'Category comparison', kind: 'bar', explanation: `Compares the number of ${t.name} records in each ${category.name}.` }
  }

  if (has(text,'top','best','highest','most') && has(text,'customer','client','buyer')) {
    const customer = customers, fact = items ?? orders, measure = amount(fact) ?? (items && quantity && value ? quantity : undefined)
    if (!customer || !fact || !measure) throw new Error('I could not identify customers and a purchase amount in the schema.')
    const name = col(customer,['customername','clientname','buyername','name'])
    const path = joinPath(schema,fact,customer) ?? inferredPath(schema,fact,customer)
    if (!name || !path) throw new Error('I could not find a reliable customer name and relationship path.')
    const factAlias = path.alias.get(fact.name) ?? 'a', customerAlias = path.alias.get(customer.name)!
    const aggregate = items && !amount(items) && quantity && value ? `SUM(${factAlias}.${q(quantity.name)} * ${factAlias}.${q(value.name)})` : `SUM(${factAlias}.${q(measure.name)})`
    return { sql: `SELECT ${customerAlias}.${q(name.name)} AS customer, ${aggregate} AS total_purchase FROM ${q(fact.name)} ${factAlias} ${path.joins.join(' ')} GROUP BY ${customerAlias}.${q(name.name)} ORDER BY total_purchase DESC LIMIT 5`, title: 'Top customers', kind: 'bar', explanation: `Ranks customers by purchase value using ${fact.name} and the detected relationship to ${customer.name}.` }
  }

  if (has(text,'product','item') && has(text,'best','top','perform','popular','sales')) {
    const product = products, fact = items ?? orders, measure = amount(fact) ?? (items && quantity && value ? quantity : undefined)
    if (!product || !fact || !measure) throw new Error('I could not identify products and a sales measure in the schema.')
    const name = col(product,['productname','itemname','name','title']), path = joinPath(schema,fact,product) ?? inferredPath(schema,fact,product)
    if (!name || !path) throw new Error('I could not find a reliable product relationship in the schema.')
    const fa = path.alias.get(fact.name) ?? 'a', pa = path.alias.get(product.name)!
    const aggregate = items && !amount(items) && quantity && value ? `SUM(${fa}.${q(quantity.name)} * ${fa}.${q(value.name)})` : `SUM(${fa}.${q(measure.name)})`
    return { sql: `SELECT ${pa}.${q(name.name)} AS product, ${aggregate} AS sales FROM ${q(fact.name)} ${fa} ${path.joins.join(' ')} GROUP BY ${pa}.${q(name.name)} ORDER BY sales DESC LIMIT 10`, title: 'Best-performing products', kind: 'bar', explanation: `Ranks products by the detected sales measure from ${fact.name}.` }
  }

  if (has(text,'revenue','sales','purchase amount','total sales','total purchase')) {
    if (items && quantity && value) return { sql: `SELECT SUM(a.${q(quantity.name)} * a.${q(value.name)}) AS total_revenue FROM ${q(items.name)} a`, title: 'Total revenue', kind: 'table', explanation: `Totals ${quantity.name} × ${value.name} from ${items.name}.` }
    const t = schema.find(x => amount(x))
    const c = t && amount(t)
    if (!t || !c) throw new Error('I could not identify a numeric revenue or sales column.')
    return { sql: `SELECT SUM(a.${q(c.name)}) AS total_revenue FROM ${q(t.name)} a`, title: 'Total revenue', kind: 'table', explanation: `Sums ${c.name} from ${t.name}.` }
  }

  throw new Error('I can answer questions about table counts, revenue, top customers or products, monthly trends, categories, and missing values. Try one of the examples.')
}

export function describeResult(data: QueryData, answer: Answer): string {
  if (!data.rows.length) return 'The query returned no matching rows.'
  if (data.rows.length === 1 && data.columns.length === 1) return `${answer.explanation} The result is ${String(data.rows[0][data.columns[0]])}.`
  return `${answer.explanation} Showing ${data.rows.length} ${data.rows.length === 1 ? 'row' : 'rows'}.`
}
