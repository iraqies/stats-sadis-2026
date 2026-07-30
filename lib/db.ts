import { createClient } from '@libsql/client'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'students.db')

let db: Awaited<ReturnType<typeof createClient>>

export function getDb() {
  if (!db) {
    const url = process.env.TURSO_DB_URL || `file:${DB_PATH}`
    const authToken = process.env.TURSO_DB_TOKEN
    db = createClient(authToken ? { url, authToken } : { url })
  }
  return db
}

export function closeDb() {
  if (db) { db.close(); db = undefined as any }
}

export interface StudentRow {
  student_id: string
  sequence: number
  name: string
  name_norm: string
  average: number
  total: number
  result: string
  school: string
  branch: string
  grades: string
  lughat: number
  najah_bonus: number
  total_adjusted: number
  average_adjusted: number
  rank_overall: number | null
  rank_branch: number | null
  branch_total: number | null
}
