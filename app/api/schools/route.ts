import { getDb, ensureIndexes } from '@/lib/db'
import { cleanSchoolName } from '@/lib/school'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  let limit = parseInt(req.nextUrl.searchParams.get('limit') || '100')
  if (Number.isNaN(limit) || limit < 1) limit = 100
  if (limit > 200) limit = 200

  const db = getDb()
  try {
    await ensureIndexes()
    const all = await db.execute(
      'SELECT student_id, school, directorate, total_adjusted, average_adjusted FROM students ORDER BY average_adjusted DESC LIMIT 1000',
    )

    const schoolsMap = new Map<string, { school: string; school_raw: string; directorate: string; weight: number; student_count: number; total_score: number }>()
    for (let rank = 0; rank < all.rows.length; rank++) {
      const s = all.rows[rank] as any
      if (!s.school) continue
      const key = s.school
      if (!schoolsMap.has(key)) {
        schoolsMap.set(key, { school: s.school, school_raw: s.school, directorate: s.directorate || '', weight: 0, student_count: 0, total_score: 0 })
      }
      const entry = schoolsMap.get(key)!
      entry.weight += (1000 - rank)
      entry.student_count += 1
      entry.total_score += Number(s.total_adjusted) || 0
    }

    const results = Array.from(schoolsMap.values())
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit)
      .map((s, i) => ({
        rank: i + 1,
        school: cleanSchoolName(s.school),
        school_raw: s.school_raw,
        directorate: s.directorate,
        student_count: s.student_count,
        avg_score: s.student_count > 0 ? parseFloat((s.total_score / s.student_count).toFixed(2)) : 0,
        total_weight: s.weight,
      }))

    return NextResponse.json(
      { results, total: schoolsMap.size, total_students: all.rows.length },
      { headers: cacheHeaders() },
    )
  } catch (e) {
    console.error('Schools failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json(
      { results: [], total: 0, total_students: 0 },
      { headers: cacheHeaders() },
    )
  }
}

function cacheHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'public, max-age=300, s-maxage=600',
    // Netlify strips query strings from the cache key by default; vary on them
    // so each limit gets its own cache entry.
    'Netlify-Vary': 'query',
  }
}
