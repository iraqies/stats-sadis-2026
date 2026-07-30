import { getDb } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')?.trim()
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })
  const db = getDb()
  const row = await db.execute({ sql: 'SELECT * FROM students WHERE student_id = ?', args: [id] })
  const s = row.rows[0] as any
  if (!s) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({
    student_id: s.student_id,
    sequence: s.sequence,
    name: s.name,
    name_display: s.name_norm,
    average: s.average,
    total: s.total,
    result: s.result,
    school: s.school,
    branch: s.branch,
    grades: JSON.parse(s.grades || '{}'),
    lughat: s.lughat,
    najah_bonus: s.najah_bonus,
    total_adjusted: s.total_adjusted,
    average_adjusted: s.average_adjusted,
    rank_overall: s.rank_overall,
    rank_branch: s.rank_branch,
    branch_total: s.branch_total,
  })
}
