import { getDb, ensureIndexes } from '@/lib/db'
import { normalizeArabic } from '@/lib/normalize'
import { cleanSchoolName } from '@/lib/school'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const FTS_TABLE = 'students_fts'
const FIELDS =
  'student_id, sequence, name, name_norm, average, total, result, school, branch, grades, ' +
  'lughat, najah_bonus, total_adjusted, average_adjusted, rank_overall, rank_branch, branch_total, directorate'
// Same columns, qualified, for queries that JOIN the FTS table (its own
// name_norm column would otherwise be ambiguous).
const QFIELDS = FIELDS.split(',').map((c) => `students.${c.trim()}`).join(', ')
const MAX_RESULTS = 300

let ftsReady: boolean | null = null

async function hasFts(db: ReturnType<typeof getDb>): Promise<boolean> {
  if (ftsReady !== null) return ftsReady
  try {
    const res = await db.execute(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${FTS_TABLE}'`,
    )
    ftsReady = (res.rows[0] as any)?.name === FTS_TABLE
  } catch {
    ftsReady = false
  }
  return ftsReady
}

// Turn a normalized query into FTS5 MATCH syntax: prefix terms joined by AND,
// e.g. "ابراهيم هيثم" -> `"ابراهيم"* AND "هيثم"*`
function buildMatch(qNorm: string): string {
  const terms = qNorm
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
  return terms.join(' AND ') || '""*'
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ results: [], total: 0 })

  const qNorm = normalizeArabic(q)
  const db = getDb()

  try {
    await ensureIndexes()
    if (await hasFts(db)) {
      const match = buildMatch(qNorm)
      const [rows, count, idRows, idCount] = await Promise.all([
        db.execute({
          sql: `SELECT ${QFIELDS} FROM students JOIN ${FTS_TABLE} ON students.rowid = ${FTS_TABLE}.rowid
                WHERE ${FTS_TABLE} MATCH ?1
                ORDER BY students.average_adjusted DESC
                LIMIT ${MAX_RESULTS}`,
          args: [match],
        }),
        db.execute({
          sql: `SELECT COUNT(*) AS c FROM ${FTS_TABLE} WHERE ${FTS_TABLE} MATCH ?1`,
          args: [match],
        }),
        db.execute({
          sql: `SELECT ${FIELDS} FROM students
                WHERE student_id LIKE ?1
                ORDER BY average_adjusted DESC
                LIMIT ${MAX_RESULTS}`,
          args: [qNorm + '%'],
        }),
        db.execute({
          sql: `SELECT COUNT(*) AS c FROM students WHERE student_id LIKE ?1`,
          args: [qNorm + '%'],
        }),
      ])

      const byId = new Map<string, any>()
      for (const s of [...rows.rows, ...idRows.rows]) {
        if (s && s.student_id != null) byId.set(s.student_id, s)
      }
      const merged = Array.from(byId.values())
        .sort((a, b) => (b.average_adjusted || 0) - (a.average_adjusted || 0))
        .slice(0, MAX_RESULTS)
      const total = (Number((count.rows[0] as any)?.c) || 0) + (Number((idCount.rows[0] as any)?.c) || 0)

      return NextResponse.json({
        results: merged.map(formatStudent),
        total,
      })
    }

    // Fallback (no FTS yet): index-backed id prefix + LIKE on normalized name.
    const like = `%${qNorm}%`
    const [rows, total] = await Promise.all([
      db.execute({
        sql: `SELECT ${FIELDS} FROM students
              WHERE student_id LIKE ?1 OR name_norm LIKE ?2
              ORDER BY average_adjusted DESC
              LIMIT ${MAX_RESULTS}`,
        args: [like, like],
      }),
      db.execute({
        sql: `SELECT COUNT(*) AS c FROM students
              WHERE student_id LIKE ?1 OR name_norm LIKE ?2`,
        args: [like, like],
      }),
    ])
    return NextResponse.json({
      results: rows.rows.map(formatStudent),
      total: Number((total.rows[0] as any)?.c) || 0,
    })
  } catch (e) {
    console.error('Search failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ results: [], total: 0 })
  }
}

function formatStudent(s: any) {
  if (!s) return {}
  return {
    student_id: s.student_id,
    sequence: s.sequence,
    name: s.name,
    name_display: s.name_norm,
    average: s.average,
    total: s.total,
    result: s.result,
    school: cleanSchoolName(s.school),
    school_raw: s.school,
    directorate: s.directorate || '',
    branch: s.branch,
    grades: parseGrades(s.grades),
    lughat: s.lughat,
    najah_bonus: s.najah_bonus,
    total_adjusted: s.total_adjusted,
    average_adjusted: s.average_adjusted,
    rank_overall: s.rank_overall,
    rank_branch: s.rank_branch,
    branch_total: s.branch_total,
  }
}

function parseGrades(grades: any): Record<string, string> {
  if (grades == null) return {}
  if (typeof grades === 'object') return grades
  try {
    return JSON.parse(String(grades))
  } catch {
    return {}
  }
}
