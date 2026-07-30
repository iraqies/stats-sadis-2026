import { createClient } from '@libsql/client'

let _client: ReturnType<typeof createClient> | null = null

export function getDb() {
  if (!_client) {
    _client = createClient({
      url: process.env.TURSO_DB_URL || '',
      authToken: process.env.TURSO_DB_TOKEN || '',
    })
  }
  return {
    async execute(query: string | { sql: string; args?: any[] }): Promise<{ rows: any[] }> {
      try {
        const client = _client!
        if (typeof query === 'string') {
          const rs = await client.execute(query)
          return { rows: rs.rows }
        } else {
          const rs = await client.execute({
            sql: query.sql,
            args: query.args as any[] || [],
          })
          return { rows: rs.rows }
        }
      } catch (e) {
        return { rows: [] }
      }
    },
    close() {
      _client?.close()
      _client = null
    },
  }
}

export function closeDb() {
  _client?.close()
  _client = null
}
