import { getDb } from '@/lib/db'
import { normalizeArabic } from '@/lib/normalize'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ results: [], total: 0 })
  const qNorm = normalizeArabic(q)
  const db = getDb()
  const like = `%${qNorm}%`
  const [rows, total] = await Promise.all([
    db.execute({
      sql: `SELECT * FROM students
            WHERE student_id LIKE ?
               OR name_norm LIKE ?
            ORDER BY total_adjusted DESC
            LIMIT 300`,
      args: [like, like],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as c FROM students
            WHERE student_id LIKE ?
               OR name_norm LIKE ?`,
      args: [like, like],
    }),
  ])
  return NextResponse.json({
    results: rows.rows.map(formatStudent),
    total: Number((total.rows[0] as any).c),
  })
}

function formatStudent(s: any) {
  return {
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
  }
}
