import { ensureIndexes, batch } from '@/lib/db'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await ensureIndexes()
    const [total, branches] = await batch([
      'SELECT COUNT(*) as c FROM students',
      'SELECT branch, COUNT(*) as c FROM students GROUP BY branch ORDER BY c DESC',
    ])
    const t = (total[0] || {}) as any
    const branchMap: Record<string, number> = {}
    for (const row of branches) {
      const r = row as any
      if (r.branch) branchMap[r.branch] = Number(r.c) || 0
    }
    return NextResponse.json(
      { total: Number(t.c || 0), branches: branchMap },
      { headers: { 'Cache-Control': 'public, max-age=600, s-maxage=900' } },
    )
  } catch (e) {
    console.error('Stats failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json(
      { total: 0, branches: {} },
      { headers: { 'Cache-Control': 'public, max-age=60' } },
    )
  }
}
