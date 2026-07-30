import { getDb } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  let limit = parseInt(req.nextUrl.searchParams.get('limit') || '100')
  if (limit > 200) limit = 200

  const db = getDb()
  const all = await db.execute(
    'SELECT student_id, school, total_adjusted, average_adjusted FROM students ORDER BY average_adjusted DESC LIMIT 1000',
  )

  const schoolsMap = new Map<string, { school: string; weight: number; student_count: number; total_score: number }>()
  for (let rank = 0; rank < all.rows.length; rank++) {
    const s = all.rows[rank] as any
    if (!s.school) continue
    const key = s.school
    if (!schoolsMap.has(key)) {
      schoolsMap.set(key, { school: s.school, weight: 0, student_count: 0, total_score: 0 })
    }
    const entry = schoolsMap.get(key)!
    entry.weight += (1000 - rank)
    entry.student_count += 1
    entry.total_score += s.total_adjusted || 0
  }

  const results = Array.from(schoolsMap.values())
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((s, i) => ({
      rank: i + 1,
      school: s.school,
      student_count: s.student_count,
      avg_score: parseFloat((s.total_score / s.student_count).toFixed(2)),
      total_weight: s.weight,
    }))

  return NextResponse.json({ results, total: schoolsMap.size, total_students: all.rows.length })
}
