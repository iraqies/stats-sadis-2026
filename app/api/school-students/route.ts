import { getDb } from '@/lib/db'
import { cleanSchoolName } from '@/lib/school'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const school = req.nextUrl.searchParams.get('school')?.trim()
  if (!school) return NextResponse.json({ error: 'missing school' }, { status: 400 })
  let limit = parseInt(req.nextUrl.searchParams.get('limit') || '50')
  if (limit > 200) limit = 200

  const db = getDb()
  const [t, rows] = await Promise.all([
    db.execute({ sql: 'SELECT COUNT(*) as c FROM students WHERE school = ?1', args: [school] }),
    db.execute({ sql: 'SELECT * FROM students WHERE school = ?1 ORDER BY average_adjusted DESC LIMIT ?2', args: [school, limit] }),
  ])
  const total = Number((t.rows[0] as any).c)

  let rank = 1
  const results = rows.rows.map((s: any, i: number) => {
    if (i > 0 && s.average_adjusted < (rows.rows[i - 1] as any).average_adjusted) rank = i + 1
    return {
      student_id: s.student_id,
      name: s.name,
      name_display: s.name_norm,
      branch: s.branch,
      average_adjusted: s.average_adjusted,
      total_adjusted: s.total_adjusted,
      result: s.result,
      grades: JSON.parse(s.grades || '{}'),
      school: cleanSchoolName(s.school),
      school_raw: s.school,
      directorate: s.directorate || '',
      school_rank: rank,
    }
  })

  return NextResponse.json({ results, total, school })
}
