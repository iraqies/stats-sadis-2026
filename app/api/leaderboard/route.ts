import { getDb } from '@/lib/db'
import { cleanSchoolName } from '@/lib/school'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const branch = req.nextUrl.searchParams.get('branch')?.trim() || ''
  let limit = parseInt(req.nextUrl.searchParams.get('limit') || '100')
  if (limit > 1000) limit = 1000

  const db = getDb()
  let rows: any
  let total: number

  if (branch) {
    const [t, r] = await Promise.all([
      db.execute({ sql: 'SELECT COUNT(*) as c FROM students WHERE branch = ?1', args: [branch] }),
      db.execute({ sql: 'SELECT * FROM students WHERE branch = ?1 ORDER BY average_adjusted DESC LIMIT ?2', args: [branch, limit] }),
    ])
    total = Number((t.rows[0] as any).c)
    rows = r
  } else {
    const [t, r] = await Promise.all([
      db.execute('SELECT COUNT(*) as c FROM students'),
      db.execute({ sql: 'SELECT * FROM students ORDER BY average_adjusted DESC LIMIT ?1', args: [limit] }),
    ])
    total = Number((t.rows[0] as any).c)
    rows = r
  }

  const results = rows.rows.map((s: any) => ({
    student_id: s.student_id,
    name: s.name,
    name_display: s.name_norm,
    school: cleanSchoolName(s.school),
    school_raw: s.school,
    directorate: s.directorate || '',
    branch: s.branch,
    average_adjusted: s.average_adjusted,
    total_adjusted: s.total_adjusted,
    grades: JSON.parse(s.grades || '{}'),
    leader_rank: 0,
  }))

  let rank = 1
  for (let i = 0; i < results.length; i++) {
    if (i > 0 && results[i].average_adjusted < results[i - 1].average_adjusted) rank = i + 1
    results[i].leader_rank = rank
  }

  return NextResponse.json({ results, total })
}
