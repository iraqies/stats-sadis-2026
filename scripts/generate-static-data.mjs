// Precompute the heavy, static read endpoints (leaderboard, schools, stats)
// into public/data/*.json at build/dev time.
//
// The 2026 results are static, so these three endpoints never need a Turso
// round-trip at request time. Serving them as plain files from the Netlify
// CDN removes the function cold start + HTTP latency that made the site feel
// slow. Search, student profiles and school student lists stay dynamic.
//
// Reads from the local webapp/students.db when present, otherwise falls back
// to Turso. Skips entirely (exit 0) when neither is available so builds keep
// using previously committed files.
//
//   npm run generate:data
//   TURSO_DB_URL=... TURSO_DB_TOKEN=... node scripts/generate-static-data.mjs

import { createClient } from '@libsql/client'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const dataDir = path.join(root, 'public', 'data')

const localDb = path.join(root, 'students.db')
const TURSO_URL = process.env.TURSO_DB_URL
const TURSO_TOKEN = process.env.TURSO_DB_TOKEN

function cleanSchoolName(name) {
  return String(name || '').replace(/^\d+_/, '').replace(/_/g, ' ')
}

const LEADER_FIELDS =
  'student_id, name, name_norm, school, directorate, branch, total_adjusted, average_adjusted'

let db
if (existsSync(localDb)) {
  db = createClient({ url: `file:${localDb}` })
  console.log('Source: local students.db')
} else if (TURSO_URL && TURSO_TOKEN) {
  db = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN })
  console.log('Source: Turso')
} else {
  console.log('No local DB and no TURSO_DB_URL/TURSO_DB_TOKEN set — skipping static generation.')
  process.exit(0)
}

async function main() {
  // Local DB may predate the Turso indexes; ensure the two the leaderboard
  // queries rely on so generation doesn't full-scan 631k rows per query.
  await db.execute('CREATE INDEX IF NOT EXISTS idx_avg ON students(average_adjusted)')
  await db.execute('CREATE INDEX IF NOT EXISTS idx_branch_avg ON students(branch, average_adjusted)')

  const total = Number((await db.execute('SELECT COUNT(*) AS c FROM students')).rows[0].c)
  const branchRows = await db.execute(
    'SELECT branch, COUNT(*) AS c FROM students GROUP BY branch ORDER BY c DESC',
  )
  const branches = {}
  for (const r of branchRows.rows) {
    if (r.branch) branches[r.branch] = Number(r.c)
  }

  mkdirSync(dataDir, { recursive: true })

  // Same query + rank logic as app/api/leaderboard/route.ts so the static file
  // is byte-for-byte equivalent to what the API used to return.
  async function leaderboard(branch) {
    const where = branch ? 'WHERE branch = ?1' : ''
    const args = branch ? [branch] : []
    const r = await db.execute({
      sql: `SELECT ${LEADER_FIELDS} FROM students
            ${where}
            ORDER BY average_adjusted DESC, total_adjusted DESC
            LIMIT 1000`,
      args,
    })
    const results = r.rows.map((s) => ({
      student_id: s.student_id,
      name: s.name,
      name_display: s.name_norm,
      school: cleanSchoolName(s.school),
      school_raw: s.school,
      directorate: s.directorate || '',
      branch: s.branch,
      average_adjusted: s.average_adjusted,
      total_adjusted: s.total_adjusted,
      leader_rank: 0,
    }))
    let rank = 1
    for (let i = 0; i < results.length; i++) {
      if (i > 0 && Number(results[i].average_adjusted) < Number(results[i - 1].average_adjusted)) {
        rank = i + 1
      }
      results[i].leader_rank = rank
    }
    return { results, total: branch ? (branches[branch] || results.length) : total }
  }

  const leaderboards = { all: await leaderboard(null) }
  for (const branch of Object.keys(branches)) {
    leaderboards[branch] = await leaderboard(branch)
    console.log(`  leaderboard ${branch}: ${leaderboards[branch].total.toLocaleString()} students`)
  }
  writeFileSync(path.join(dataDir, 'leaderboards.json'), JSON.stringify(leaderboards))
  console.log(`  leaderboards.json (${Object.keys(leaderboards).length} boards)`)

  // Same top-1000 simulation + weight aggregation as app/api/schools/route.ts.
  const top = await db.execute(
    'SELECT student_id, school, directorate, total_adjusted, average_adjusted FROM students ORDER BY average_adjusted DESC LIMIT 1000',
  )
  const schoolsMap = new Map()
  for (let rank = 0; rank < top.rows.length; rank++) {
    const s = top.rows[rank]
    if (!s.school) continue
    const key = s.school
    if (!schoolsMap.has(key)) {
      schoolsMap.set(key, {
        school: s.school,
        school_raw: s.school,
        directorate: s.directorate || '',
        weight: 0,
        student_count: 0,
        total_score: 0,
      })
    }
    const entry = schoolsMap.get(key)
    entry.weight += 1000 - rank
    entry.student_count += 1
    entry.total_score += Number(s.total_adjusted) || 0
  }
  const schools = {
    results: Array.from(schoolsMap.values())
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 200)
      .map((s, i) => ({
        rank: i + 1,
        school: cleanSchoolName(s.school),
        school_raw: s.school_raw,
        directorate: s.directorate,
        student_count: s.student_count,
        avg_score:
          s.student_count > 0 ? parseFloat((s.total_score / s.student_count).toFixed(2)) : 0,
        total_weight: s.weight,
      })),
    total: schoolsMap.size,
    total_students: top.rows.length,
  }
  writeFileSync(path.join(dataDir, 'schools.json'), JSON.stringify(schools))
  console.log(`  schools.json (${schools.total} schools)`)

  writeFileSync(path.join(dataDir, 'stats.json'), JSON.stringify({ total, branches }))
  console.log(`  stats.json (${total.toLocaleString()} students, ${Object.keys(branches).length} branches)`)

  db.close()
  console.log(`Static data written to ${dataDir}`)
}

main().catch((e) => {
  console.error('generate-static-data failed:', e.message)
  process.exit(1)
})
