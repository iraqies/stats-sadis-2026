// One-time migration for the Turso database.
//
// The original upload scripts never created indexes and there is no full-text
// index, so leaderboard/school queries full-scan ~631k rows and search has to
// run LIKE over the whole table (which times out in serverless functions).
//
// This script is idempotent and can be run any time:
//   TURSO_DB_URL=https://...turso.io TURSO_DB_TOKEN=... node scripts/migrate-turso.mjs
//
// It only touches Turso (the data lives there already); no local DB is needed.

const DB_URL = process.env.TURSO_DB_URL
const TOKEN = process.env.TURSO_DB_TOKEN

if (!DB_URL || !TOKEN) {
  console.log('Skipping migration: TURSO_DB_URL / TURSO_DB_TOKEN not set.')
  process.exit(0)
}

async function exec(sql) {
  const res = await fetch(`${DB_URL}/v2/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql } }] }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Turso HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = await res.json()
  const result = data.results?.[0]
  if (result?.type === 'error') {
    throw new Error(`Turso SQL error: ${result.error?.message ?? JSON.stringify(result.error)}`)
  }
  return result
}

function firstCount(result) {
  const rows = result?.response?.result?.rows || []
  const cols = result?.response?.result?.cols || []
  if (!rows[0]) return 0
  const c = rows[0].find((_, i) => cols[i]?.name === 'c')
  return Number(c?.value ?? 0)
}

// PRAGMA table_info(students) returns one row per column; cell index 1 = name.
function columnNames(result) {
  const rows = result?.response?.result?.rows || []
  return rows.map((r) => r?.[1]?.value).filter(Boolean)
}

const t0 = Date.now()

try {
  console.log('[1/4] Reading table schema...')
  const schema = await exec('PRAGMA table_info(students)')
  const names = columnNames(schema)
  const hasNameNorm = names.includes('name_norm')
  console.log(`  columns: ${names.join(', ')}`)

  if (!hasNameNorm) {
    console.log('\nERROR: students table is missing the `name_norm` column.')
    console.log('This table was uploaded from an old dump. Please re-run the seed script:')
    console.log('  node scripts/seed-turso.mjs')
    process.exit(1)
  }

  console.log('[2/4] Creating indexes (no-op if they already exist)...')
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_avg ON students(average_adjusted)',
    'CREATE INDEX IF NOT EXISTS idx_branch_avg ON students(branch, average_adjusted)',
    'CREATE INDEX IF NOT EXISTS idx_name_norm ON students(name_norm)',
    'CREATE INDEX IF NOT EXISTS idx_student_id ON students(student_id)',
    'CREATE INDEX IF NOT EXISTS idx_school ON students(school)',
    'CREATE INDEX IF NOT EXISTS idx_branch ON students(branch)',
  ]
  for (const sql of indexes) {
    await exec(sql)
    console.log(`  OK ${sql.replace('CREATE INDEX IF NOT EXISTS ', '').replace(/ ON .*/, '')}`)
  }

  console.log('[3/4] Creating FTS5 full-text table...')
  await exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS students_fts USING fts5(name_norm, content='students', content_rowid='rowid')",
  )
  console.log('  OK students_fts')

  const total = firstCount(await exec('SELECT COUNT(*) AS c FROM students'))
  // COUNT(*) on an external-content FTS5 table reflects the content table, so
  // check the shadow index table instead (0 when the FTS index is empty).
  const ftsCount = firstCount(await exec('SELECT COUNT(*) AS c FROM students_fts_idx'))
  console.log(`  students: ${total.toLocaleString()}, fts index entries: ${ftsCount.toLocaleString()}`)

  if (ftsCount === 0) {
    console.log('  Building full-text index (one-time, takes a minute or two)...')
    // Chunk the build so no single HTTP statement runs long enough to time out.
    const bounds = (await exec('SELECT MIN(rowid) AS mn, MAX(rowid) AS mx FROM students'))
      .response.result.rows[0]
    const mn = Number(bounds[0]?.value ?? 0)
    const mx = Number(bounds[1]?.value ?? 0)
    const CHUNK = 50000
    for (let lo = mn; lo <= mx; lo += CHUNK) {
      const hi = Math.min(lo + CHUNK - 1, mx)
      await exec(
        `INSERT INTO students_fts(rowid, name_norm) SELECT rowid, name_norm FROM students WHERE rowid BETWEEN ${lo} AND ${hi}`,
      )
      process.stdout.write(`\r  indexed rows ${lo.toLocaleString()}–${hi.toLocaleString()}`)
    }
    console.log('')
    const after = firstCount(await exec('SELECT COUNT(*) AS c FROM students_fts_idx'))
    console.log(`  Done. FTS index entries now: ${after.toLocaleString()}`)
  } else {
    console.log('  FTS index already populated, skipping build.')
  }

  console.log('[4/4] Verifying...')
  await exec('SELECT name FROM sqlite_master WHERE type = \'table\' AND name = \'students_fts\'')
  const check = firstCount(await exec('SELECT COUNT(*) AS c FROM students'))
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s. Turso has ${check.toLocaleString()} students.`)
} catch (e) {
  console.error('\nMigration failed:', e.message)
  process.exit(1)
}
