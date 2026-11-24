import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { dashboard } from '@/lib/planning';
import { dashboardQuerySchema } from '@/lib/validation';
import { bnNum, pct, unitBn } from '@/lib/domain/format';

type SP = Promise<Record<string, string | string[] | undefined>>;

function Bar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  const color = v >= 75 ? 'var(--ok)' : v >= 40 ? '#b54708' : 'var(--danger)';
  return (
    <div role="img" aria-label={`${label}: ${bnNum(v)}%`} style={{ background: '#eef2ef', borderRadius: 6, height: 10, overflow: 'hidden' }}>
      <div style={{ width: `${v}%`, height: '100%', background: color }} />
    </div>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: SP }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/dashboard');
  if (user.role === 'VOLUNTEER') redirect('/field');
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v));
  const scope = dashboardQuerySchema.parse(flat);
  const [data, upazilas, unions] = await Promise.all([
    dashboard(user, scope),
    prisma.area.findMany({ where: { level: 'UPAZILA' }, orderBy: { name: 'asc' } }),
    prisma.area.findMany({ where: { level: 'UNION' }, orderBy: { name: 'asc' } }),
  ]);

  return (
    <div className="stack">
      <h1>ঘাটতি ও কভারেজ</h1>

      <form method="get" className="card filters" aria-label="এলাকা বাছুন">
        <div>
          <label htmlFor="upazilaId">উপজেলা</label>
          <select id="upazilaId" name="upazilaId" defaultValue={scope.upazilaId ?? ''}>
            <option value="">সব</option>
            {upazilas.map((a) => <option key={a.id} value={a.id}>{a.nameBn}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="unionId">ইউনিয়ন</label>
          <select id="unionId" name="unionId" defaultValue={scope.unionId ?? ''}>
            <option value="">সব</option>
            {unions.map((a) => <option key={a.id} value={a.id}>{a.nameBn}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="submit">দেখুন</button>
          <Link href="/dashboard" className="btn btn-secondary">সব এলাকা</Link>
        </div>
      </form>

      <section className="grid" aria-label="মোট হিসাব">
        <div className="card">
          <div className="hint">নিবন্ধিত পরিবার</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{bnNum(data.totals.households)}</div>
        </div>
        <div className="card">
          <div className="hint">অন্তত একবার ত্রাণ পেয়েছে (নিশ্চিত)</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{bnNum(data.totals.reached)} <span className="hint">({bnNum(pct(data.totals.reached, data.totals.households))}%)</span></div>
          <Bar value={pct(data.totals.reached, data.totals.households)} label="ত্রাণ পেয়েছে" />
        </div>
        <div className="card" style={{ borderColor: data.totals.unreached ? '#fecdca' : undefined }}>
          <div className="hint">এখনো কিছুই পায়নি</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: data.totals.unreached ? 'var(--danger)' : undefined }}>{bnNum(data.totals.unreached)}</div>
          <a href="#unreached">তালিকা দেখুন ↓</a>
        </div>
      </section>

      <section className="card stack" aria-labelledby="gap-h">
        <h2 id="gap-h" style={{ marginTop: 0 }}>ক্যাটাগরি অনুযায়ী ঘাটতি <span className="hint">(প্রতি ক্যাটাগরির এক চক্রের হিসাব)</span></h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">ত্রাণ</th>
                <th scope="col">চাহিদা</th>
                <th scope="col">দেওয়া হয়েছে (নিশ্চিত)</th>
                <th scope="col">বাকি ঘাটতি</th>
                <th scope="col">হাতে মজুদ</th>
                <th scope="col">পরিবার কভারেজ</th>
              </tr>
            </thead>
            <tbody>
              {data.overall.map(({ category: c, gap: g, stockAvailable }) => {
                const u = unitBn(c.unit);
                const canCover = g.gap > 0 ? pct(Math.min(stockAvailable, g.gap), g.gap) : 100;
                return (
                  <tr key={c.id}>
                    <th scope="row">{c.nameBn}<div className="hint">শেষ {bnNum(g.windowDays)} দিন</div></th>
                    <td>{bnNum(g.need)} {u}</td>
                    <td>{bnNum(g.delivered)} {u}{g.pending > 0 && <div className="hint">+ {bnNum(g.pending)} অপেক্ষমাণ</div>}</td>
                    <td><strong style={{ color: g.gap ? 'var(--danger)' : 'var(--ok)' }}>{bnNum(g.gap)} {u}</strong></td>
                    <td>{bnNum(stockAvailable)} {u}<div className="hint">{g.gap > 0 ? `ঘাটতির ${bnNum(canCover)}% মেটানো যাবে` : 'ঘাটতি নেই'}</div></td>
                    <td style={{ minWidth: 140 }}>{bnNum(g.covered)} / {bnNum(g.households)} ({bnNum(g.coveragePct)}%)<Bar value={g.coveragePct} label={`${c.nameBn} কভারেজ`} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ margin: 0 }}>চাহিদা = প্রতিটি পরিবারের এক চক্রের প্রয়োজন (যেমন খাদ্য: পরিবারপ্রতি ৭ দিনে ১ প্যাকেট; পানি: জনপ্রতি দিনে ৩ লিটার)। শুধু কার্ড কোডে নিশ্চিত বিতরণ গণনা হয়।</p>
      </section>

      <section className="card stack" aria-labelledby="union-h">
        <h2 id="union-h" style={{ marginTop: 0 }}>ইউনিয়ন অনুযায়ী</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">ইউনিয়ন</th>
                <th scope="col">পরিবার</th>
                <th scope="col">কিছুই পায়নি</th>
                {data.categories.map((c) => <th key={c.id} scope="col">{c.nameBn} কভারেজ</th>)}
              </tr>
            </thead>
            <tbody>
              {data.byUnion.map((u) => (
                <tr key={u.union.id}>
                  <th scope="row"><Link href={`/dashboard?unionId=${u.union.id}`}>{u.union.nameBn}</Link></th>
                  <td>{bnNum(u.households)}</td>
                  <td style={{ color: u.unreached ? 'var(--danger)' : undefined }}>{bnNum(u.unreached)}</td>
                  {u.gaps.map((g) => <td key={g.categoryId}>{bnNum(g.coveragePct)}%<Bar value={g.coveragePct} label="কভারেজ" /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="unreached" className="card stack" aria-labelledby="un-h">
        <h2 id="un-h" style={{ marginTop: 0 }}>এখনো কোনো ত্রাণ পায়নি: সবচেয়ে বেশি প্রয়োজন আগে</h2>
        {data.unreached.length === 0 ? <p>এই এলাকার সব পরিবার অন্তত একবার ত্রাণ পেয়েছে।</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">পরিবার</th><th scope="col">ওয়ার্ড</th><th scope="col">স্কোর</th><th scope="col">কেন জরুরি</th></tr></thead>
              <tbody>
                {data.unreached.map((h) => (
                  <tr key={h.id}>
                    <td><Link href={`/households/${h.id}`}>{h.headName}</Link>{!h.hasPhone && <div className="hint">ফোন নেই: সরাসরি যেতে হবে</div>}</td>
                    <td>{h.wardName}</td>
                    <td><strong>{bnNum(h.score)}</strong></td>
                    <td className="hint">{h.reasons.map((r) => r.label).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.totals.unreached > data.unreached.length && <p className="hint">প্রথম {bnNum(data.unreached.length)}টি দেখানো হচ্ছে। এলাকা বেছে আরও দেখুন।</p>}
        <p><Link href="/plan" className="btn">এদের জন্য বরাদ্দ পরিকল্পনা করুন →</Link></p>
      </section>
    </div>
  );
}
