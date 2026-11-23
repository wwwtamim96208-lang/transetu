import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listAreas, listHouseholds } from '@/lib/households';
import { listQuerySchema } from '@/lib/validation';

const DAMAGE_BN = { NONE: 'নেই', PARTIAL: 'আংশিক', SEVERE: 'গুরুতর', TOTAL: 'সম্পূর্ণ' } as const;

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function HouseholdsPage({ searchParams }: { searchParams: SP }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/households');

  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v));
  const q = listQuerySchema.parse(flat);
  const [data, areas] = await Promise.all([listHouseholds(user, q), listAreas()]);

  const upazilas = areas.filter((a) => a.level === 'UPAZILA');
  const unions = areas.filter((a) => a.level === 'UNION' && (user.role !== 'VOLUNTEER' || a.id === user.areaId));
  const wards = areas.filter((a) => a.level === 'WARD' && unions.some((u) => u.id === a.parentId));

  const pageLink = (page: number) => {
    const p = new URLSearchParams(flat as Record<string, string>);
    p.set('page', String(page));
    return `/households?${p}`;
  };

  return (
    <div className="stack">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>পরিবার তালিকা</h1>
        <Link href="/households/new" className="btn">+ নতুন পরিবার</Link>
      </div>

      {/* Plain GET form: works without JavaScript and keeps filters in the URL. */}
      <form method="get" className="card filters" role="search" aria-label="পরিবার খুঁজুন">
        <div>
          <label htmlFor="q">খুঁজুন</label>
          <input id="q" name="q" type="search" defaultValue={q.q ?? ''} placeholder="নাম, ফোন, NID-এর শেষ ৪ অঙ্ক" />
        </div>
        {user.role !== 'VOLUNTEER' && (
          <div>
            <label htmlFor="upazilaId">উপজেলা</label>
            <select id="upazilaId" name="upazilaId" defaultValue={q.upazilaId ?? ''}>
              <option value="">সব</option>
              {upazilas.map((a) => <option key={a.id} value={a.id}>{a.nameBn}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="unionId">ইউনিয়ন</label>
          <select id="unionId" name="unionId" defaultValue={q.unionId ?? ''}>
            <option value="">সব</option>
            {unions.map((a) => <option key={a.id} value={a.id}>{a.nameBn}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="wardId">ওয়ার্ড</label>
          <select id="wardId" name="wardId" defaultValue={q.wardId ?? ''}>
            <option value="">সব</option>
            {wards.map((a) => <option key={a.id} value={a.id}>{a.nameBn}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="damage">ক্ষতির মাত্রা</label>
          <select id="damage" name="damage" defaultValue={q.damage ?? ''}>
            <option value="">সব</option>
            {Object.entries(DAMAGE_BN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="sort">সাজান</label>
          <select id="sort" name="sort" defaultValue={`${q.sort}`}>
            <option value="createdAt">নিবন্ধনের সময়</option>
            <option value="headName">নাম</option>
            <option value="memberCount">সদস্য সংখ্যা</option>
          </select>
        </div>
        <div>
          <label htmlFor="order">ক্রম</label>
          <select id="order" name="order" defaultValue={q.order}>
            <option value="desc">বড় থেকে ছোট / নতুন আগে</option>
            <option value="asc">ছোট থেকে বড় / পুরনো আগে</option>
          </select>
        </div>
        <label className="check" htmlFor="vulnerable">
          <input id="vulnerable" name="vulnerable" type="checkbox" value="1" defaultChecked={!!q.vulnerable} />
          শুধু ঝুঁকিপূর্ণ পরিবার
        </label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="submit">প্রয়োগ করুন</button>
          <Link href="/households" className="btn btn-secondary">মুছুন</Link>
        </div>
      </form>

      <p aria-live="polite"><strong>{data.total.toLocaleString('bn-BD')}</strong>টি পরিবার পাওয়া গেছে</p>

      <div className="table-wrap">
        <table>
          <caption className="visually-hidden">নিবন্ধিত পরিবারের তালিকা</caption>
          <thead>
            <tr>
              <th scope="col">পরিবার প্রধান</th>
              <th scope="col">এলাকা</th>
              <th scope="col">সদস্য</th>
              <th scope="col">ঝুঁকি</th>
              <th scope="col">ক্ষতি</th>
              <th scope="col" className="hide-sm">নিবন্ধনকারী</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr><td colSpan={6}>কোনো পরিবার পাওয়া যায়নি। ফিল্টার বদলে দেখুন।</td></tr>
            )}
            {data.items.map((h) => (
              <tr key={h.id}>
                <td>
                  <Link href={`/households/${h.id}`}>{h.headName}</Link>
                  <div className="hint">{h.phone ?? 'ফোন নেই'}{h.nidMasked ? ` · NID ${h.nidMasked}` : ' · NID নেই'}</div>
                </td>
                <td>{h.unionName}<div className="hint">{h.wardName}</div></td>
                <td>{h.memberCount.toLocaleString('bn-BD')}</td>
                <td>
                  {h.vulnerableCount > 0 && <span className="badge badge-warn">{h.vulnerableCount.toLocaleString('bn-BD')} জন ঝুঁকিপূর্ণ</span>}
                  {h.femaleHeaded && <> <span className="badge">নারী-প্রধান</span></>}
                </td>
                <td>{DAMAGE_BN[h.damageLevel]}</td>
                <td className="hide-sm">{h.orgName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav className="pager" aria-label="পাতা">
        <span>পাতা {data.page.toLocaleString('bn-BD')} / {data.pages.toLocaleString('bn-BD')}</span>
        <span style={{ display: 'flex', gap: '0.5rem' }}>
          {data.page > 1 && <Link className="btn btn-secondary" href={pageLink(data.page - 1)}>← আগের</Link>}
          {data.page < data.pages && <Link className="btn btn-secondary" href={pageLink(data.page + 1)}>পরের →</Link>}
        </span>
      </nav>
    </div>
  );
}
