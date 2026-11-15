import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownToLine, ArrowRight, BarChart3, Check, ChevronDown, ChevronRight, CircleHelp, Database as DatabaseIcon, FileUp, HardDrive, LayoutDashboard, LockKeyhole, MessageSquareText, Plus, Search, ShieldCheck, Sparkles, Table2, Upload, X } from 'lucide-react'
import type { Database, SqlJsStatic } from 'sql.js'
import { createSample, getEngine, inspect, runQuery, type QueryData, type Schema, type TableInfo } from './db'
import { describeResult, generate, type Answer } from './query'

const suggestions = [
  { label: 'Top 5 customers by spend', question: 'Who are the top 5 customers by total purchase amount?' },
  { label: 'Revenue by month', question: 'Show monthly revenue trends' },
  { label: 'Best-selling products', question: 'Which products have the best sales?' },
  { label: 'Records in each table', question: 'How many records are in each table?' },
  { label: 'Compare product categories', question: 'Compare products by category' },
  { label: 'Check missing values', question: 'Find missing values' },
]
const colors = ['#c8f36a', '#80c99f', '#84b9a6', '#d2bc7b', '#a3a993', '#72a99b', '#df9b78', '#90a8c2', '#b6c58b', '#c29fba']
const format = (v: unknown) => typeof v === 'number' ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v) : v === null ? 'NULL' : String(v)

export default function App() {
  const [db, setDb] = useState<Database | null>(null)
  const [SQL, setSQL] = useState<SqlJsStatic | null>(null)
  const [schema, setSchema] = useState<Schema>([])
  const [dbName, setDbName] = useState('Sample commerce data')
  const [sample, setSample] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [result, setResult] = useState<QueryData | null>(null)
  const [selected, setSelected] = useState('')
  const [expanded, setExpanded] = useState(true)
  const [activeNav, setActiveNav] = useState<'explore' | 'overview'>('explore')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const schemaRef = useRef<Schema>([])

  const load = useCallback(async (file?: File) => {
    setLoading(true); setError('')
    try {
      const Engine = await getEngine()
      setSQL(Engine)
      let next: Database
      let name: string
      let isSample: boolean
      if (file) {
        if (!/\.(db|sqlite|sqlite3)$/i.test(file.name)) throw new Error('Choose a .db, .sqlite, or .sqlite3 database file.')
        if (file.size > 50 * 1024 * 1024) throw new Error('This demo supports database files up to 50 MB.')
        next = new Engine.Database(new Uint8Array(await file.arrayBuffer()))
        name = file.name; isSample = false
      } else {
        next = createSample(Engine); name = 'Sample commerce data'; isSample = true
      }
      const nextSchema = inspect(next)
      if (!nextSchema.some(t => t.type === 'table')) { next.close(); throw new Error('This file does not contain any readable SQLite tables.') }
      db?.close()
      setDb(next); setSchema(nextSchema); schemaRef.current = nextSchema; setDbName(name); setSample(isSample)
      setSelected(nextSchema.find(t => t.type === 'table')?.name ?? '')
      setAnswer(null); setResult(null); setQuestion(''); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open this SQLite database.') }
    finally { setLoading(false) }
  }, [db])

  useEffect(() => { void load(); return () => { db?.close() } }, []) // load the in-browser demo once
  useEffect(() => { schemaRef.current = schema }, [schema])

  const run = (value = question) => {
    if (!db || !value.trim()) return
    setError('')
    try {
      const built = generate(value, schemaRef.current)
      const data = runQuery(db, built.sql)
      setQuestion(value); setAnswer(built); setResult(data)
      setActiveNav('explore')
    } catch (e) { setError(e instanceof Error ? e.message : 'I could not answer that question safely.') }
  }

  const totals = useMemo(() => ({ tables: schema.filter(t => t.type === 'table').length, rows: schema.reduce((n,t)=>n+(t.count ?? 0),0), columns: schema.reduce((n,t)=>n+t.columns.length,0), sizeLabel: sample ? 'Built in' : 'Local file' }), [schema, sample])
  const activeTable = schema.find(t => t.name === selected)
  const numericSummary = useMemo(() => activeTable?.columns.filter(c => /int|real|num|dec|float|double/i.test(c.type)).map(c => {
    try {
      const colName = `"${c.name.replaceAll('"','""')}"`, tableName = `"${activeTable.name.replaceAll('"','""')}"`
      const out = db?.exec(`SELECT AVG(${colName}), MIN(${colName}), MAX(${colName}) FROM ${tableName} WHERE ${colName} IS NOT NULL`)[0]?.values[0]
      return { name: c.name, avg: out?.[0], min: out?.[1], max: out?.[2] }
    } catch { return { name: c.name, avg: '—', min: '—', max: '—' } }
  }) ?? [], [activeTable, db])

  const pickFile = () => fileRef.current?.click()
  const onFiles = (files: FileList | null) => { if (files?.[0]) void load(files[0]) }
  const chartable = Boolean(result && result.rows.length > 1 && result.columns.length >= 2 && answer?.kind !== 'table')
  const chartType = answer?.kind === 'line' ? 'line' : 'bar'

  return <div className="app-shell" onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={e=>{if (e.currentTarget===e.target) setDragging(false)}} onDrop={e=>{e.preventDefault();setDragging(false);onFiles(e.dataTransfer.files)}}>
    {dragging && <div className="drop-overlay"><div><FileUp size={34}/><strong>Drop your SQLite file to open</strong><span>Processed privately in this browser</span></div></div>}
    <aside className="rail">
      <div className="brand"><div className="brand-mark"><DatabaseIcon size={17}/></div><span>db<span className="brand-light">/insight</span></span></div>
      <div className="rail-label">WORKSPACE</div>
      <button className={`nav-item ${activeNav==='explore'?'active':''}`} onClick={()=>setActiveNav('explore')}><MessageSquareText size={17}/> Explore <span className="nav-dot"/></button>
      <button className={`nav-item ${activeNav==='overview'?'active':''}`} onClick={()=>setActiveNav('overview')}><LayoutDashboard size={17}/> Overview</button>
      <div className="rail-rule"/>
      <div className="schema-heading"><span className="rail-label">YOUR DATA</span><button className="icon-button tiny" onClick={pickFile} title="Add a database"><Plus size={15}/></button></div>
      <button className="database-entry" onClick={()=>setExpanded(!expanded)}><ChevronDown className={expanded?'':'rotated'} size={14}/><DatabaseIcon size={15}/><span title={dbName}>{dbName}</span></button>
      {expanded && <div className="table-list">{schema.filter(t=>t.type==='table').map(t=><button key={t.name} className={`table-entry ${selected===t.name?'selected':''}`} onClick={()=>{setSelected(t.name);setActiveNav('overview')}}><Table2 size={14}/><span>{t.name}</span><small>{t.count?.toLocaleString() ?? '—'}</small></button>)}</div>}
      <button className="upload-side" onClick={pickFile}><Upload size={15}/> Open a database</button>
      <div className="rail-bottom"><div className="privacy-stamp"><LockKeyhole size={14}/><div><b>Private by design</b><span>Your data stays on this device.</span></div></div><div className="engine-tag"><span/>LOCAL DEMO ENGINE</div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="crumb"><span>Workspace</span><ChevronRight size={14}/><b>{activeNav==='overview'?'Database overview':'Explore'}</b></div><div className="top-actions"><span className="local-chip"><ShieldCheck size={14}/> Browser only</span><button className="button secondary small" onClick={pickFile}><Upload size={15}/> Open database</button><input ref={fileRef} type="file" accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3" hidden onChange={e=>{onFiles(e.target.files);e.currentTarget.value=''}}/></div></header>
      <div className="content-wrap">
        {loading && <div className="loading-bar"><span/></div>}
        {error && <div className="error-banner"><CircleHelp size={16}/><span>{error}</span><button onClick={()=>setError('')}><X size={15}/></button></div>}
        {activeNav==='overview' ? <section className="overview-page">
          <div className="eyebrow">DATABASE OVERVIEW <span>·</span> {sample?'DEMO DATA': 'LOCAL FILE'}</div>
          <div className="page-title-row"><div><h1>Know what’s<br className="mobile-break"/> inside your data.</h1><p className="page-subtitle">A clear view of the structure behind <b>{dbName}</b>.</p></div><button className="button secondary" onClick={()=>setActiveNav('explore')}><MessageSquareText size={16}/> Ask a question</button></div>
          <div className="metric-grid"><Metric label="TABLES" value={totals.tables} icon={<Table2/>}/><Metric label="TOTAL RECORDS" value={totals.rows.toLocaleString()} icon={<DatabaseIcon/>}/><Metric label="COLUMNS" value={totals.columns} icon={<BarChart3/>}/><Metric label="DATA LOCATION" value="This browser" icon={<HardDrive/>} subdued/></div>
          <div className="overview-columns"><div className="panel schema-panel"><div className="panel-head"><div><div className="section-kicker">STRUCTURE</div><h2>Tables & fields</h2></div><span className="count-pill">{schema.length} objects</span></div>
            {schema.map(t=><div className="schema-card" key={t.name}><button className="schema-table-head" onClick={()=>setSelected(selected===t.name?'':t.name)}><span className="table-icon"><Table2 size={15}/></span><b>{t.name}</b><span className="object-type">{t.type}</span><span className="row-count">{t.count === null?'View':`${t.count.toLocaleString()} rows`}</span><ChevronDown className={selected===t.name?'rotated':''} size={15}/></button>
              {(selected===t.name || schema.length===1) && <div className="column-list"><div className="column-heading"><span>FIELD</span><span>TYPE</span><span>KEY</span></div>{t.columns.map(c=><div className="column-row" key={c.name}><span className="column-name">{c.name}</span><code>{c.type.toUpperCase()||'—'}</code><span>{c.pk?<i className="key-tag">PK</i>:t.relations.find(r=>r.from===c.name)?<i className="key-tag fk">FK</i>:''}</span></div>)}{t.relations.map((r,i)=><div className="relation-note" key={i}>↳ {r.from} references {r.toTable}.{r.to}</div>)}</div>}
            </div>)}
          </div><div className="panel numeric-panel"><div className="panel-head"><div><div className="section-kicker">FIELD PROFILE</div><h2>{activeTable?.name ?? 'Select a table'}</h2></div></div>{activeTable ? <>{numericSummary.length ? <div className="numeric-list"><div className="numeric-heading"><span>NUMERIC FIELD</span><span>AVERAGE</span><span>RANGE</span></div>{numericSummary.map(n=><div key={n.name} className="numeric-row"><b>{n.name}</b><span>{format(n.avg)}</span><small>{format(n.min)} — {format(n.max)}</small></div>)}</div>:<div className="empty-note">No numeric fields in this table.</div>}<div className="profile-foot"><span>NULL CHECK</span><button onClick={()=>run('Find missing values')}>Inspect missing values <ArrowRight size={14}/></button></div></>:<div className="empty-note">Choose a table to see a profile.</div>}</div></div>
          <div className="privacy-note"><ShieldCheck size={16}/><div><b>Local by default</b><span>The database is loaded into browser memory. No upload endpoint or remote database service is involved.</span></div></div>
        </section> : <section className="explore-page">
          <div className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line"/> PRIVATE DATA EXPLORATION <span className="eyebrow-dot">·</span> {sample?'SAMPLE DATABASE':'LOCAL DATABASE'}</div><h1>Make sense of<br/><em>what’s in your data.</em></h1><p className="intro">Ask a question in plain language. Get a transparent SQL query and a useful answer, all on your device.</p></div><div className="welcome-graphic" aria-hidden="true"><div className="graphic-ring ring-one"/><div className="graphic-ring ring-two"/><div className="graphic-core"><DatabaseIcon size={24}/></div><span className="graphic-orbit orbit-a"/><span className="graphic-orbit orbit-b"/><span className="graphic-orbit orbit-c"/></div></div>
          <div className="stat-strip"><div><span className="stat-label">DATABASE</span><b title={dbName}>{dbName}</b></div><div><span className="stat-label">TABLES</span><b>{totals.tables}</b></div><div><span className="stat-label">RECORDS</span><b>{totals.rows.toLocaleString()}</b></div><div><span className="stat-label">PROCESSING</span><b className="safe-value"><i/> In browser</b></div><button title="Open another SQLite database" className="swap-db" onClick={pickFile}><ArrowDownToLine size={16}/></button></div>
          <div className="query-composer"><div className="composer-top"><div className="composer-icon"><Sparkles size={16}/></div><div><b>Ask your data</b><span>Describe what you’d like to find</span></div><div className="engine-label"><span/> DEMO QUERY ENGINE</div></div><div className="input-wrap"><textarea ref={inputRef} value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();run()}}} placeholder="e.g. Who are my top 5 customers by spend?" rows={2}/><button className="ask-button" onClick={()=>run()} disabled={!question.trim()||loading}>Explore <ArrowRight size={16}/></button></div><div className="composer-foot"><span><LockKeyhole size={12}/> Queries run against the database in your browser</span><kbd>ENTER ↵</kbd></div></div>
          {!result && <div className="suggestions-block"><div className="suggestion-title"><span>START WITH A QUESTION</span><span className="suggestion-rule"/></div><div className="suggestion-grid">{suggestions.map((s,i)=><button key={s.label} className="suggestion" onClick={()=>run(s.question)}><span className="suggestion-num">0{i+1}</span><span>{s.label}</span><ArrowRight size={14}/></button>)}</div></div>}
          {result && answer && <div className="result-panel"><div className="result-top"><div><div className="section-kicker">QUERY RESULT <span>·</span> {result.rows.length.toLocaleString()} ROWS</div><h2>{answer.title}</h2></div><button className="icon-button" onClick={()=>{setResult(null);setAnswer(null)}} title="Clear result"><X size={17}/></button></div><p className="result-explanation">{describeResult(result,answer)}</p>
            {chartable && <div className="chart-area"><div className="chart-header"><b>{answer.title}</b><span>{chartType==='line'?'MONTHLY TREND':'COMPARISON'}</span></div><ResponsiveContainer width="100%" height={240}>{chartType==='line' ? <LineChart data={result.rows} margin={{top:12,right:16,bottom:0,left:0}}><CartesianGrid stroke="#29312d" vertical={false}/><XAxis dataKey={result.columns[0]} tick={{fill:'#818a83',fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:'#818a83',fontSize:11}} axisLine={false} tickLine={false} width={55}/><Tooltip contentStyle={{background:'#1a211d',border:'1px solid #343d37',borderRadius:6,color:'#f2f2e9'}}/><Line type="monotone" dataKey={result.columns[1]} stroke="#c8f36a" strokeWidth={2.4} dot={{r:3,fill:'#c8f36a',stroke:'#151b17',strokeWidth:2}} activeDot={{r:5}}/></LineChart> : <BarChart data={result.rows} margin={{top:8,right:14,bottom:0,left:0}}><CartesianGrid stroke="#29312d" vertical={false}/><XAxis dataKey={result.columns[0]} tick={{fill:'#818a83',fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:'#818a83',fontSize:11}} axisLine={false} tickLine={false} width={55}/><Tooltip contentStyle={{background:'#1a211d',border:'1px solid #343d37',borderRadius:6,color:'#f2f2e9'}}/><Bar dataKey={result.columns[1]} radius={[3,3,0,0]}>{result.rows.map((_,i)=><Cell key={i} fill={colors[i%colors.length]}/>)}</Bar></BarChart>}</ResponsiveContainer></div>}
            <div className="result-table-wrap"><table className="result-table"><thead><tr>{result.columns.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{result.rows.slice(0,50).map((row,i)=><tr key={i}>{result.columns.map(c=><td key={c}>{format(row[c])}</td>)}</tr>)}</tbody></table>{result.rows.length>50&&<div className="table-more">Showing first 50 of {result.rows.length} rows</div>}</div>
            <details className="sql-details"><summary><code>SQL</code><span>View generated query</span><ChevronDown size={14}/></summary><pre>{answer.sql}</pre></details>
          </div>}
          <div className="disclaimer"><div className="disclaimer-icon"><Sparkles size={14}/></div><span><b>Local demo query engine</b> · Rule-based SQL generation, not an LLM. Unsupported questions are explained instead of guessed.</span><button title="About this engine"><CircleHelp size={15}/></button></div>
        </section>}
      </div>
      <footer className="bottomline"><span>DB / INSIGHT</span><span>YOUR DATA STAYS YOURS <i/> NO CLOUD UPLOAD</span></footer>
    </main>
  </div>
}

function Metric({label,value,icon,subdued=false}:{label:string,value:string|number,icon:React.ReactNode,subdued?:boolean}) { return <div className="metric-card"><div className="metric-top"><span>{label}</span><div>{icon}</div></div><strong className={subdued?'subdued':''}>{value}</strong></div> }
