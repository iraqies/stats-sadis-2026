import { getDb } from '@/lib/db'
import { cleanSchoolName } from '@/lib/school'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Student profiles don't change (static exam results), so let the CDN cache
// them instead of hitting Turso on every modal open.
const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800',
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')?.trim()
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })
  const db = getDb()
  try {
    // Ranks (rank_overall/rank_branch/branch_total) are precomputed in the DB
    // by db_setup.py, so a profile is a single lookup — no need for the 3
    // COUNT() queries over 631k rows the old code ran on every request.
    const row = await db.execute({ sql: 'SELECT * FROM students WHERE student_id = ?1', args: [id] })
    const s = row.rows[0] as any
    if (!s) return NextResponse.json({ error: 'not found' }, { status: 404 })

    return NextResponse.json(
      {
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
      },
      { headers: CACHE_HEADERS },
    )
  } catch (e) {
    console.error('Student lookup failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 })
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
