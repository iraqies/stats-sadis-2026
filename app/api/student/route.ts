import { getDb } from '@/lib/db'
import { cleanSchoolName } from '@/lib/school'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')?.trim()
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })
  const db = getDb()
  try {
    const row = await db.execute({ sql: 'SELECT * FROM students WHERE student_id = ?1', args: [id] })
    const s = row.rows[0] as any
    if (!s) return NextResponse.json({ error: 'not found' }, { status: 404 })

    const [rankOverall, rankBranch, branchTotal] = await Promise.all([
      db.execute({ sql: 'SELECT COUNT(*) as c FROM students WHERE average_adjusted > ?1', args: [s.average_adjusted || 0] }),
      db.execute({ sql: 'SELECT COUNT(*) as c FROM students WHERE branch = ?1 AND average_adjusted > ?2', args: [s.branch, s.average_adjusted || 0] }),
      db.execute({ sql: 'SELECT COUNT(*) as c FROM students WHERE branch = ?1', args: [s.branch] }),
    ])

    return NextResponse.json({
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
      rank_overall: Number((rankOverall.rows[0] as any)?.c) + 1,
      rank_branch: Number((rankBranch.rows[0] as any)?.c) + 1,
      branch_total: Number((branchTotal.rows[0] as any)?.c),
    })
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
