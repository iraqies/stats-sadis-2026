import { getDb } from '@/lib/db'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const db = getDb()
  const [total, branches] = await Promise.all([
    db.execute('SELECT COUNT(*) as c FROM students'),
    db.execute('SELECT branch, COUNT(*) as c FROM students GROUP BY branch ORDER BY c DESC'),
  ])
  const t = (total.rows[0] || {}) as any
  const branchMap: Record<string, number> = {}
  for (const row of branches.rows) {
    const r = row as any
    if (r.branch) branchMap[r.branch] = Number(r.c)
  }
  return NextResponse.json({ total: Number(t.c || 0), branches: branchMap })
}
