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

  console.log('Creating schema in Turso (without indexes for faster inserts)...')
  await turso.execute('DROP TABLE IF EXISTS students')
  await turso.execute(`CREATE TABLE students (
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
    branch_total INTEGER,
    directorate TEXT DEFAULT ''
  )`)

  console.log('Migrating data in batches...')
  const BATCH_SIZE = 5000
  let offset = 0
  const stmt = `INSERT OR REPLACE INTO students
    (student_id, sequence, name, name_norm, average, total, result,
     school, branch, grades, lughat, najah_bonus,
     total_adjusted, average_adjusted, rank_overall, rank_branch, branch_total, directorate)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`

  while (offset < total) {
    const result = await local.execute({
      sql: `SELECT * FROM students ORDER BY student_id LIMIT ? OFFSET ?`,
      args: [BATCH_SIZE, offset],
    })
    const statements = result.rows.map(r => ({
      sql: stmt,
      args: [
        r.student_id, r.sequence, r.name, r.name_norm,
        r.average, r.total, r.result,
        r.school, r.branch, r.grades,
        r.lughat || 0, r.najah_bonus || 0,
        r.total_adjusted || 0, r.average_adjusted || 0,
        r.rank_overall, r.rank_branch, r.branch_total,
        r.directorate || '',
      ],
    }))
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        await turso.batch(statements, 'write')
        break
      } catch (e) {
        console.error(`  error: ${e.message}`)
        if (attempt < 9) {
          const wait = 5000 * Math.pow(1.5, attempt)
          console.log(`  retry ${attempt + 1} after ${wait}ms...`)
          await new Promise(r => setTimeout(r, wait))
        } else throw e
      }
    }
    offset += result.rows.length
    const pct = ((offset / total) * 100).toFixed(1)
    console.log(`  ${offset}/${total} (${pct}%)`)
    // no delay
  }

  console.log('Creating indexes...')
  await turso.execute('CREATE INDEX IF NOT EXISTS idx_name_norm ON students(name_norm)')
  await turso.execute('CREATE INDEX IF NOT EXISTS idx_student_id ON students(student_id)')
  await turso.execute('CREATE INDEX IF NOT EXISTS idx_school ON students(school)')
  await turso.execute('CREATE INDEX IF NOT EXISTS idx_branch ON students(branch)')

  const verify = await turso.execute('SELECT COUNT(*) as c FROM students')
  console.log(`\nDone. Turso has ${Number(verify.rows[0].c)} students`)

  local.close()
  turso.close()
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
