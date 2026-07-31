import { getDb, ensureIndexes, batch } from '@/lib/db'
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

// The dataset is static (2026 exam results), so repeated queries can be served
// from the Netlify CDN instead of hitting the Turso edge on every keystroke.
const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',
}

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
  if (!q) return NextResponse.json({ results: [], total: 0 }, { headers: CACHE_HEADERS })

  const qNorm = normalizeArabic(q)
  if (!qNorm) return NextResponse.json({ results: [], total: 0 }, { headers: CACHE_HEADERS })

  const db = getDb()

  try {
    await ensureIndexes()
    if (await hasFts(db)) {
      const match = buildMatch(qNorm)
      // All four statements in ONE pipeline request (single HTTP round-trip).
      const [rows, count, idRows, idCount] = await batch([
        {
          // ORDER BY rank (FTS5's built-in relevance, same as bm25) triggers
          // the FTS5 top-N optimization: SQLite walks the index and keeps only
          // the best 300 rowids, then fetches exactly those few content rows.
          // Sorting by average_adjusted or bm25() instead forces SQLite to pull
          // EVERY match from the content table before sorting — that is what
          // made common names like "محمد" time out (verified with EXPLAIN QUERY
          // PLAN: `ORDER BY rank` => INDEX 32 top-N, no temp b-tree).
          sql: `SELECT ${QFIELDS} FROM ${FTS_TABLE}
                JOIN students ON students.rowid = ${FTS_TABLE}.rowid
                WHERE ${FTS_TABLE} MATCH ?1
                ORDER BY rank
                LIMIT ${MAX_RESULTS}`,
          args: [match],
        },
        {
          sql: `SELECT COUNT(*) AS c FROM ${FTS_TABLE} WHERE ${FTS_TABLE} MATCH ?1`,
          args: [match],
        },
        {
          sql: `SELECT ${FIELDS} FROM students
                WHERE student_id LIKE ?1
                ORDER BY average_adjusted DESC
                LIMIT ${MAX_RESULTS}`,
          args: [qNorm + '%'],
        },
        {
          sql: `SELECT COUNT(*) AS c FROM students WHERE student_id LIKE ?1`,
          args: [qNorm + '%'],
        },
      ])

      const seen = new Set<string>()
      const merged: any[] = []
      for (const s of [...rows, ...idRows]) {
        if (s && s.student_id != null && !seen.has(s.student_id)) {
          seen.add(s.student_id)
          merged.push(s)
        }
      }
      const limited = merged.slice(0, MAX_RESULTS)
      const total =
        (Number((count[0] as any)?.c) || 0) + (Number((idCount[0] as any)?.c) || 0)

      return NextResponse.json(
        { results: limited.map(formatStudent), total },
        { headers: CACHE_HEADERS },
      )
    }

    // Fallback (no FTS yet): index-backed id prefix + LIKE on normalized name.
    const like = `%${qNorm}%`
    const [rows, total] = await batch([
      {
        sql: `SELECT ${FIELDS} FROM students
              WHERE student_id LIKE ?1 OR name_norm LIKE ?2
              ORDER BY average_adjusted DESC
              LIMIT ${MAX_RESULTS}`,
        args: [like, like],
      },
      {
        sql: `SELECT COUNT(*) AS c FROM students
              WHERE student_id LIKE ?1 OR name_norm LIKE ?2`,
        args: [like, like],
      },
    ])
    return NextResponse.json(
      { results: rows.map(formatStudent), total: Number((total[0] as any)?.c) || 0 },
      { headers: CACHE_HEADERS },
    )
  } catch (e) {
    console.error('Search failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ results: [], total: 0 }, { headers: CACHE_HEADERS })
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
