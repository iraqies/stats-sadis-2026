import { batch } from '@/lib/db'
import { cleanSchoolName } from '@/lib/school'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const FIELDS =
  'student_id, name, name_norm, school, directorate, branch, result, grades, total_adjusted, average_adjusted'

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800',
}

export async function GET(req: NextRequest) {
  const school = req.nextUrl.searchParams.get('school')?.trim()
  if (!school) return NextResponse.json({ error: 'missing school' }, { status: 400 })
  let limit = parseInt(req.nextUrl.searchParams.get('limit') || '50')
  if (Number.isNaN(limit) || limit < 1) limit = 50
  if (limit > 200) limit = 200

  try {
    const [t, rows] = await batch([
      { sql: 'SELECT COUNT(*) as c FROM students WHERE school = ?1', args: [school] },
      {
        sql: `SELECT ${FIELDS} FROM students
              WHERE school = ?1
              ORDER BY average_adjusted DESC
              LIMIT ?2`,
        args: [school, limit],
      },
    ])
    const total = Number((t[0] as any)?.c) || 0

    let rank = 1
    const results = rows.map((s: any, i: number) => {
      if (i > 0 && Number(s.average_adjusted) < Number((rows[i - 1] as any).average_adjusted)) rank = i + 1
      return {
        student_id: s.student_id,
        name: s.name,
        name_display: s.name_norm,
        branch: s.branch,
        average_adjusted: s.average_adjusted,
        total_adjusted: s.total_adjusted,
        result: s.result,
        grades: parseGrades(s.grades),
        school: cleanSchoolName(s.school),
        school_raw: s.school,
        directorate: s.directorate || '',
        school_rank: rank,
      }
    })

    return NextResponse.json({ results, total, school }, { headers: CACHE_HEADERS })
  } catch (e) {
    console.error('School students failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ results: [], total: 0, school }, { headers: CACHE_HEADERS })
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
