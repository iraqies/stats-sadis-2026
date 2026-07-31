'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface Student {
  student_id: string
  name: string
  name_display?: string
  average?: string
  total?: string
  result?: string
  school?: string
  branch?: string
  grades?: Record<string, string>
  lughat?: number
  najah_bonus?: number
  total_adjusted?: number
  average_adjusted?: number
  rank_overall?: number
  rank_branch?: number
  branch_total?: number
  [key: string]: any
}

export default function Page() {
  const [tab, setTab] = useState('search')
  const [stats, setStats] = useState({ total: 0, branches: {} as Record<string, number> })
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Student[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const [profile, setProfile] = useState<Student | null>(null)
  const [lbBranch, setLbBranch] = useState('')
  const [lbData, setLbData] = useState<{ results: Student[]; total: number } | null>(null)
  const [scData, setScData] = useState<{ results: any[]; total: number } | null>(null)
  const [schoolStudents, setSchoolStudents] = useState<Student[] | null>(null)

  useEffect(() => { fetchStats() }, [])

  async function fetchStats() {
    try {
      const r = await fetch('/api/stats')
      const d = await r.json()
      setStats({
        total: Number(d?.total) || 0,
        branches: (d?.branches && typeof d.branches === 'object') ? d.branches : {},
      })
    } catch { }
  }

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setCount(0); return }
    setLoading(true)
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      const d = await r.json()
      setResults(Array.isArray(d?.results) ? d.results : [])
      setCount(Number(d?.total) || 0)
    } catch { setResults([]); setCount(0) }
    setLoading(false)
  }, [])

  function onSearchInput(val: string) {
    setQuery(val)
    clearTimeout(timerRef.current)
    if (val.trim().length < 2) { setResults([]); setCount(0); return }
    timerRef.current = setTimeout(() => doSearch(val.trim()), 400)
  }

  function resultClass(val: string) {
    if (val.includes('نجح') || val.includes('ناجح')) return 'result-P'
    if (val.includes('رس') || val.includes('راسب')) return 'result-F'
    if (val.includes('عيد') || val.includes('معيد')) return 'result-R'
    return ''
  }

  async function showProfile(id: string) {
    try {
      const r = await fetch(`/api/student?id=${encodeURIComponent(id)}`)
      const s = await r.json()
      setProfile(s && s.student_id ? s : null)
    } catch { setProfile(null) }
  }

  async function loadLeaderboard(branch?: string) {
    setLbData(null)
    const params = new URLSearchParams({ limit: '1000' })
    if (branch) params.set('branch', branch)
    try {
      const r = await fetch(`/api/leaderboard?${params}`)
      const d = await r.json()
      setLbData({ results: Array.isArray(d?.results) ? d.results : [], total: Number(d?.total) || 0 })
    } catch { setLbData({ results: [], total: 0 }) }
  }

  async function loadSchools() {
    setScData(null)
    try {
      const r = await fetch('/api/schools?limit=200')
      const d = await r.json()
      setScData({ results: Array.isArray(d?.results) ? d.results : [], total: Number(d?.total) || 0 })
    } catch { setScData({ results: [], total: 0 }) }
  }

  async function showSchoolStudents(school: string) {
    try {
      const r = await fetch(`/api/school-students?school=${encodeURIComponent(school)}&limit=100`)
      const d = await r.json()
      setSchoolStudents(Array.isArray(d?.results) ? d.results : [])
    } catch { setSchoolStudents([]) }
  }

  useEffect(() => {
    if (tab === 'leaderboard') loadLeaderboard(lbBranch)
    if (tab === 'schools') loadSchools()
  }, [tab, lbBranch])

  return (
    <>
      <div className="header">
        <div className="header-inner">
          <h1>نتائج الامتحانات 2026</h1>
          <div className="stats">
            {stats.total.toLocaleString()} طالب - {Object.keys(stats.branches).length} فروع
          </div>
        </div>
      </div>

      <div className="tabs" style={{ maxWidth: 600 }}>
        {(['search', 'leaderboard', 'schools'] as const).map(t => (
          <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t === 'search' ? 'بحث' : t === 'leaderboard' ? 'الترتيب' : 'المدارس'}
          </button>
        ))}
      </div>

      <div className="main">
        {tab === 'search' && (
          <>
            <div className="search-bar">
              <input
                type="text"
                placeholder="ابحث بالاسم أو الرقم الامتحاني..."
                value={query}
                onChange={e => onSearchInput(e.target.value)}
                autoFocus
              />
              <div className="count">{count > 0 ? `${count} نتيجة` : ''}</div>
            </div>
            <AdSlot format="banner" />
            <div className="results">
              {loading && <div className="lb-loading">جاري البحث...</div>}
              {!loading && results.length === 0 && query.length >= 2 && (
                <div className="empty">لا يوجد طلاب بهذه البيانات</div>
              )}
              {results.map(s => (
                <div key={s.student_id} className="card" onClick={() => showProfile(s.student_id)}>
                  <div className="top">
                    <span className="id">{s.student_id}</span>
                    <span className="name">{s.name_display || s.name}</span>
                    <span className="meta">
                      <span>{s.school}</span>
                      <span className="dot">|</span>
                      <span>{s.directorate || s.branch}</span>
                      <span className="dot">|</span>
                      <span>{s.branch}</span>
                      <span className="dot">|</span>
                       <span>المجموع: <strong>{Number(s.total_adjusted || s.total || 0).toFixed(2)}</strong></span>
                      {s.result && <span className={`result ${resultClass(s.result)}`}>{s.result}</span>}
                    </span>
                  </div>
                  {s.grades && Object.keys(s.grades).length > 0 && (
                    <div className="grades">
                      {Object.entries(s.grades).map(([k, v]) => (
                        <span key={k}><span className="subj">{k}:</span> <span className="val">{v || '-'}</span></span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {results.length > 0 && <AdSlot format="banner" />}
          </>
        )}

        {tab === 'leaderboard' && (
          <>
            <div className="lb-header">
              <select value={lbBranch} onChange={e => setLbBranch(e.target.value)}>
                <option value="">جميع الفروع</option>
                {Object.entries(stats.branches).map(([b, c]) => (
                  <option key={b} value={b}>{b} ({c.toLocaleString()})</option>
                ))}
              </select>
              <span className="count">{lbData ? `إجمالي ${lbData.total.toLocaleString()} طالب` : ''}</span>
            </div>
            <AdSlot format="in-feed" />
            <div className="lb-table-wrap">
              <table className="lb-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>الاسم</th>
                    <th>المدرسة</th>
                    <th>المنطقة</th>
                    <th>الفرع</th>
                    <th>المعدل</th>
                    <th>المجموع</th>
                  </tr>
                </thead>
                <tbody>
                  {!lbData && <tr><td colSpan={7} className="lb-loading">جاري التحميل...</td></tr>}
                  {lbData?.results.map((s, i) => {
                    const rc = `rank${s.leader_rank === 1 ? ' rank-1' : s.leader_rank === 2 ? ' rank-2' : s.leader_rank === 3 ? ' rank-3' : ''}`
                    return (
                      <tr key={s.student_id} onClick={() => showProfile(s.student_id)}>
                        <td className={`rank ${rc}`}>{s.leader_rank}</td>
                        <td className="name">{s.name_display || s.name}</td>
                        <td className="school">{s.school}</td>
                        <td className="branch">{s.directorate || '-'}</td>
                        <td className="branch">{s.branch}</td>
                        <td className="avg">{Number(s.average_adjusted || 0).toFixed(2)}</td>
                        <td className="total">{Number(s.total_adjusted || 0).toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {lbData && <AdSlot format="banner" />}
          </>
        )}

        {tab === 'schools' && (
          <>
            <div className="lb-header">
              <span className="count">{scData ? `${scData.total.toLocaleString()} مدرسة` : ''}</span>
            </div>
            <AdSlot format="in-feed" />
            <div className="lb-table-wrap">
              <table className="lb-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>المدرسة</th>
                    <th>المنطقة</th>
                    <th>عدد الطلاب</th>
                    <th>الوزن</th>
                    <th>متوسط المجموع</th>
                  </tr>
                </thead>
                <tbody>
                  {!scData && <tr><td colSpan={6} className="lb-loading">جاري التحميل...</td></tr>}
                  {scData?.results.map(s => {
                    const rc = `rank${s.rank === 1 ? ' rank-1' : s.rank === 2 ? ' rank-2' : s.rank === 3 ? ' rank-3' : ''}`
                    return (
                      <tr key={s.school} className="clickable-row" onClick={() => showSchoolStudents(s.school_raw || s.school)}>
                        <td className={`rank ${rc}`}>{s.rank}</td>
                        <td className="name">{s.school}</td>
                        <td className="branch">{s.directorate || '-'}</td>
                        <td className="school" style={{ textAlign: 'center' }}>{Number(s.student_count || 0).toLocaleString()}</td>
                        <td className="total" style={{ textAlign: 'center' }}>{Number(s.total_weight || 0).toLocaleString()}</td>
                        <td className="avg" style={{ textAlign: 'center' }}>{Number(s.avg_score || 0).toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {scData && <AdSlot format="banner" />}
          </>
        )}
      </div>

      <div className={`overlay${profile || schoolStudents ? ' open' : ''}`} onClick={e => { if (e.target === e.currentTarget) { setProfile(null); setSchoolStudents(null) } }}>
        <div className="modal">
          <button className="close" onClick={() => { setProfile(null); setSchoolStudents(null) }}>&times;</button>
          {profile && <ProfileContent student={profile} statsTotal={stats.total} />}
          {profile && <AdSlot format="banner" />}
          {schoolStudents && (
            <>
              <h2>طلاب {schoolStudents[0]?.school || 'المدرسة'}</h2>
              <div className="sub" style={{ marginBottom: 12 }}>{schoolStudents[0]?.directorate ? `المنطقة: ${schoolStudents[0].directorate}` : ''}</div>
              <div className="results" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                {schoolStudents.map(s => (
                  <div key={s.student_id} className="card" onClick={() => { setSchoolStudents(null); showProfile(s.student_id) }} style={{ padding: '12px 16px' }}>
                    <div className="top">
                      <span className="id" style={{ fontSize: '.8rem' }}>#{s.school_rank}</span>
                      <span className="id">{s.student_id}</span>
                      <span className="name" style={{ fontSize: '.95rem' }}>{s.name_display || s.name}</span>
                      <span className="meta">
                        <span>{s.branch}</span>
                        <span className="dot">|</span>
                        <span>المجموع: <strong>{(s.total_adjusted || 0).toFixed(2)}</strong></span>
                        {s.result && <span className={`result ${resultClass(s.result)}`}>{s.result}</span>}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function AdSlot({ format }: { format?: 'banner' | 'in-feed' }) {
  return (
    <div className={`ad-container ${format === 'in-feed' ? 'ad-in-feed' : ''}`}>
      <ins className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client="ca-pub-6588852866380072"
        data-ad-slot="XXXXXXXXXX"
        data-ad-format={format === 'in-feed' ? 'fluid' : 'auto'}
        data-full-width-responsive="true"
      />
      <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
    </div>
  )
}

function ProfileContent({ student, statsTotal }: { student: Student; statsTotal: number }) {
  const s = student
  const gradeKeys = Object.keys(s.grades || {})
  const rc = s.result ? `result ${s.result?.includes('نجح') || s.result?.includes('ناجح') ? 'result-P' : s.result?.includes('رس') || s.result?.includes('راسب') ? 'result-F' : 'result-R'}` : 'result'
  return (
    <>
      <h2>{s.name_display || s.name}</h2>
      <div className="sub">{s.student_id}</div>
      <div className="rank-badge">
        {s.rank_branch && <span className="line">الترتيب في الفرع: <strong>{s.rank_branch.toLocaleString()}</strong> من {s.branch_total?.toLocaleString()}</span>}
        {s.rank_overall && <span className="line">الترتيب العام: <strong>{s.rank_overall.toLocaleString()}</strong> من {statsTotal.toLocaleString()}</span>}
      </div>
      <div className="info-grid">
        <div><div className="label">المدرسة</div><div className="value">{s.school || '-'}</div></div>
        <div><div className="label">المنطقة</div><div className="value">{s.directorate || '-'}</div></div>
        <div><div className="label">الفرع</div><div className="value">{s.branch || '-'}</div></div>
        <div><div className="label">المعدل العام</div><div className="value">{Number(s.average_adjusted || s.average || 0).toFixed(2)}</div></div>
        <div><div className="label">المجموع</div><div className="value">{Number(s.total_adjusted || s.total || 0).toFixed(2)}</div></div>
        <div><div className="label">النتيجة</div><div className="value"><span className={rc}>{s.result || '-'}</span></div></div>
      </div>
      <table className="grades-table">
        <thead><tr><th>المادة</th><th>الدرجة</th></tr></thead>
        <tbody>
          {gradeKeys.map(k => (
            <tr key={k}><td>{k}</td><td>{s.grades?.[k] || ''}</td></tr>
          ))}
          <tr className="total-row"><td>المجموع العام</td><td>{s.total || '0'}</td></tr>
          <tr className="bonus-row"><td>لغات</td><td>{s.lughat || '0'}</td></tr>
          <tr className="bonus-row"><td>ناجح</td><td>{s.najah_bonus || '0'}</td></tr>
          <tr className="total-row"><td>المجموع النهائي</td><td>{Number(s.total_adjusted || s.total || 0).toFixed(2)}</td></tr>
        </tbody>
      </table>
    </>
  )
}
