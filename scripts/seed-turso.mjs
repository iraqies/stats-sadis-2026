import { createClient } from '@libsql/client'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', 'students.db')

const TURSO_URL = process.env.TURSO_DB_URL
const TURSO_TOKEN = process.env.TURSO_DB_TOKEN

if (!TURSO_URL || !TURSO_TOKEN) {
  console.error('Missing TURSO_DB_URL or TURSO_DB_TOKEN environment variables')
  process.exit(1)
}

async function main() {
  console.log('Connecting to local DB...')
  const local = createClient({ url: `file:${DB_PATH}` })

  console.log('Connecting to Turso...')
  const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN })

  console.log('Fetching total from local DB...')
  const countResult = await local.execute('SELECT COUNT(*) as c FROM students')
  const total = Number(countResult.rows[0].c)
  console.log(`Total students: ${total}`)

  console.log('Creating schema in Turso...')
  await turso.execute(`CREATE TABLE IF NOT EXISTS students (
    student_id TEXT PRIMARY KEY,
    sequence INTEGER,
    name TEXT,
    name_norm TEXT,
    average REAL,
    total REAL,
    result TEXT,
    school TEXT,
    branch TEXT,
    grades TEXT,
    lughat REAL DEFAULT 0,
    najah_bonus REAL DEFAULT 0,
    total_adjusted REAL DEFAULT 0,
    average_adjusted REAL DEFAULT 0,
    rank_overall INTEGER,
    rank_branch INTEGER,
    branch_total INTEGER
  )`)
  await turso.execute('CREATE INDEX IF NOT EXISTS idx_name_norm ON students(name_norm)')
  await turso.execute('CREATE INDEX IF NOT EXISTS idx_student_id ON students(student_id)')
  await turso.execute('CREATE INDEX IF NOT EXISTS idx_school ON students(school)')
  await turso.execute('CREATE INDEX IF NOT EXISTS idx_branch ON students(branch)')

  console.log('Migrating data in batches...')
  const BATCH_SIZE = 500
  let offset = 0

  while (offset < total) {
    const rows = await local.execute({
      sql: `SELECT * FROM students ORDER BY student_id LIMIT ? OFFSET ?`,
      args: [BATCH_SIZE, offset],
    })

    const batch = rows.rows.map((r) => [
      r.student_id, r.sequence, r.name, r.name_norm,
      r.average, r.total, r.result,
      r.school, r.branch, r.grades,
      r.lughat || 0, r.najah_bonus || 0,
      r.total_adjusted || 0, r.average_adjusted || 0,
      r.rank_overall, r.rank_branch, r.branch_total,
    ])

    const placeholders = batch.map(() =>
      '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).join(',')

    await turso.execute({
      sql: `INSERT OR REPLACE INTO students
        (student_id, sequence, name, name_norm, average, total, result,
         school, branch, grades, lughat, najah_bonus,
         total_adjusted, average_adjusted, rank_overall, rank_branch, branch_total)
        VALUES ${placeholders}`,
      args: batch.flat(),
    })

    offset += BATCH_SIZE
    const pct = ((offset / total) * 100).toFixed(1)
    console.log(`  ${offset}/${total} (${pct}%)`)
  }

  const verify = await turso.execute('SELECT COUNT(*) as c FROM students')
  console.log(`\nDone. Turso has ${Number(verify.rows[0].c)} students`)

  local.close()
  turso.close()
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
