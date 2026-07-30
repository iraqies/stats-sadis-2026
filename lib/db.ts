const DB_URL = process.env.TURSO_DB_URL || ''
const TOKEN = process.env.TURSO_DB_TOKEN || ''

function escape(val: any): string {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'number') return String(val)
  const s = String(val)
  return "'" + s.replace(/'/g, "''") + "'"
}

export function getDb() {
  return {
    async execute(query: string | { sql: string; args?: any[] }): Promise<{ rows: any[] }> {
      try {
        let sql: string
        if (typeof query === 'string') {
          sql = query
        } else {
          let i = 0
          const args = query.args || []
          sql = query.sql.replace(/\?\d*/g, () => escape(args[i++]))
        }

        const body = JSON.stringify({
          requests: [{ type: 'execute', stmt: { sql } }],
        })

        const res = await fetch(`${DB_URL}/v2/pipeline`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            'Content-Type': 'application/json',
          },
          body,
        })

        if (!res.ok) {
          const text = await res.text()
          console.error('Turso error:', res.status, text.slice(0, 300))
          return { rows: [] }
        }

        const data = await res.json()
        const result = data.results?.[0]
        if (result?.type === 'error') {
          console.error('Turso SQL error:', result.error)
          return { rows: [] }
        }

        const cols = result?.response?.result?.cols || []
        const rows = result?.response?.result?.rows || []
        const mapped = rows.map((row: any[]) => {
          const obj: any = {}
          row.forEach((val: any, i: number) => {
            obj[cols[i]?.name || `col${i}`] = val?.value ?? null
          })
          return obj
        })

        return { rows: mapped }
      } catch (e) {
        console.error('Turso fetch error:', e)
        return { rows: [] }
      }
    },
    close() {},
  }
}

export function closeDb() {}
