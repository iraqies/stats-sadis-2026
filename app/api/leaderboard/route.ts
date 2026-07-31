import { ensureIndexes, batch } from '@/lib/db'
import { cleanSchoolName } from '@/lib/school'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const FIELDS =
  'student_id, name, name_norm, school, directorate, branch, total_adjusted, average_adjusted'

export async function GET(req: NextRequest) {
  const branch = req.nextUrl.searchParams.get('branch')?.trim() || ''
  let limit = parseInt(req.nextUrl.searchParams.get('limit') || '100')
  if (Number.isNaN(limit) || limit < 1) limit = 100
  if (limit > 1000) limit = 1000

  try {
    await ensureIndexes()
    let rows: any[]
    let total: number

    if (branch) {
      const [t, r] = await batch([
        { sql: 'SELECT COUNT(*) as c FROM students WHERE branch = ?1', args: [branch] },
        {
          sql: `SELECT ${FIELDS} FROM students
                WHERE branch = ?1
                ORDER BY average_adjusted DESC, total_adjusted DESC
                LIMIT ?2`,
          args: [branch, limit],
        },
      ])
      total = Number((t[0] as any)?.c) || 0
      rows = r
    } else {
      const [t, r] = await batch([
        'SELECT COUNT(*) as c FROM students',
        {
          sql: `SELECT ${FIELDS} FROM students
                ORDER BY average_adjusted DESC, total_adjusted DESC
                LIMIT ?1`,
          args: [limit],
        },
      ])
      total = Number((t[0] as any)?.c) || 0
      rows = r
    }

    const results = rows.map((s: any) => ({
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

    return NextResponse.json(
      { results, total },
      { headers: cacheHeaders() },
    )
  } catch (e) {
    console.error('Leaderboard failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json(
      { results: [], total: 0 },
      { headers: cacheHeaders() },
    )
  }
}

function cacheHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'public, max-age=300, s-maxage=600',
    // Netlify strips query strings from the cache key by default; vary on
    // branch/limit so each leaderboard gets its own cache entry.
    'Netlify-Vary': 'query',
  }
}
