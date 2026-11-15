import type { Schema } from './db'

export type Answer = {
  sql: string
  explanation: string
  kind: 'table' | 'bar' | 'line'
  title: string
  needsClarification: boolean
  clarificationQuestion: string
}

type ApiError = { detail?: string }

export async function askGemini(question: string, schema: Schema): Promise<Answer> {
  const tables = schema.map(table => ({
    name: table.name,
    type: table.type,
    columns: table.columns.map(column => ({
      name: column.name,
      type: column.type,
      primary_key: column.pk,
      nullable: !column.notnull && !column.pk,
    })),
  }))
  const relationships = schema.flatMap(table => table.relations.map(relation => ({
    from_table: table.name,
    from_column: relation.from,
    to_table: relation.toTable,
    to_column: relation.to,
  })))

  let response: Response
  try {
    response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, schema: { tables, relationships } }),
    })
  } catch {
    throw new Error('Could not reach the DB Insight API. Check the backend is running, then retry.')
  }

  const body = await response.json().catch(() => ({})) as ApiError & Partial<{
    sql: string; explanation: string; visualization: Answer['kind']; title: string
    needs_clarification: boolean; clarification_question: string
  }>
  if (!response.ok) throw new Error(body.detail || `The API request failed (${response.status}).`)
  if (typeof body.explanation !== 'string' || typeof body.sql !== 'string') throw new Error('The API returned an incomplete query response. Retry the question.')
  return {
    sql: body.sql,
    explanation: body.explanation,
    kind: body.visualization ?? 'table',
    title: body.title || 'Query results',
    needsClarification: Boolean(body.needs_clarification),
    clarificationQuestion: body.clarification_question || '',
  }
}
