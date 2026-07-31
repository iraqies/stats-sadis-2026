const DB_URL = process.env.TURSO_DB_URL || ''
const TOKEN = process.env.TURSO_DB_TOKEN || ''

// Turso's HTTP (v2/pipeline) protocol returns every cell as
// { type: "integer"|"float"|"text"|"null"|"blob", value: ... } where the
// integer/float `value` is a STRING. Map them to real JS values so callers get
// numbers (counts, averages, ranks) instead of strings.
function mapValue(val: any): any {
  if (val === null || val === undefined) return null
  if (typeof val === 'object' && val.type) {
    switch (val.type) {
      case 'null':
        return null
      case 'integer':
      case 'float':
        return Number(val.value)
      case 'blob':
        return val.base64 ?? null
      default:
        return val.value ?? null
    }
  }
  return val
}

function escape(val: any): string {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'number') return String(val)
  const s = String(val)
  return "'" + s.replace(/'/g, "''") + "'"
}

function buildSql(query: string | { sql: string; args?: any[] }): string {
  if (typeof query === 'string') return query
  let i = 0
  const args = query.args || []
  return query.sql.replace(/\?\d*/g, () => escape(args[i++]))
}

function mapRows(result: any): any[] {
  const cols = result?.response?.result?.cols || []
  const rows = result?.response?.result?.rows || []
  return rows.map((row: any[]) => {
    const obj: any = {}
    row.forEach((val: any, i: number) => {
      obj[cols[i]?.name || `col${i}`] = mapValue(val)
    })
    return obj
  })
}

// Run several statements in ONE v2/pipeline HTTP round-trip instead of N
// requests. Netlify serverless functions are latency-bound (cold starts +
// per-request TCP/TLS to Turso), so collapsing N round trips into 1 is the
// single biggest speedup available. Returns one mapped row array per statement,
// in the same order as `statements`.
export async function batch(
  statements: (string | { sql: string; args?: any[] })[],
): Promise<any[][]> {
  const requests = statements.map((s) => ({ type: 'execute', stmt: { sql: buildSql(s) } }))
  const body = JSON.stringify({ requests })

  const res = await fetch(`${DB_URL}/v2/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Turso HTTP ${res.status}: ${text.slice(0, 300)}`)
  }

  const data = await res.json()
  const results = data.results || []
  return results.map((result: any) => {
    if (result?.type === 'error') {
      throw new Error(`Turso SQL error: ${result.error?.message ?? JSON.stringify(result.error)}`)
    }
    return mapRows(result)
  })
}

const INDEX_STATEMENTS = [
  'CREATE INDEX IF NOT EXISTS idx_avg ON students(average_adjusted)',
  'CREATE INDEX IF NOT EXISTS idx_branch_avg ON students(branch, average_adjusted)',
  'CREATE INDEX IF NOT EXISTS idx_name_norm ON students(name_norm)',
  'CREATE INDEX IF NOT EXISTS idx_student_id ON students(student_id)',
  'CREATE INDEX IF NOT EXISTS idx_school ON students(school)',
  'CREATE INDEX IF NOT EXISTS idx_branch ON students(branch)',
]

// The upload script that seeded Turso never created indexes, so every
// leaderboard/school query was a full scan of ~631k rows. Ensure them once per
// warm instance (they are no-ops once they exist).
let readyPromise: Promise<void> | null = null

export function ensureIndexes(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      try {
        await batch(INDEX_STATEMENTS)
      } catch (e) {
        console.error('ensureIndexes failed:', e instanceof Error ? e.message : String(e))
      }
    })()
  }
  return readyPromise
}

export function getDb() {
  return {
    async execute(query: string | { sql: string; args?: any[] }): Promise<{ rows: any[] }> {
      const [res] = await batch([query])
      return { rows: res }
    },
    close() {},
  }
}

export function closeDb() {}
