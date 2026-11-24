import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listLedger } from '@/lib/distributions';
import { ledgerQuerySchema } from '@/lib/validation';
import { STATUS_BN, type DistStatus } from '@/lib/domain/distribution';
import { ConfirmDistribution } from '@/components/ConfirmDistribution';

type SP = Promise<Record<string, string | string[] | undefined>>;
const bn = (n: number) => n.toLocaleString('bn-BD');

export default async function LedgerPage({ searchParams }: { searchParams: SP }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/distributions');
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v)) as Record<string, string>;
  const q = ledgerQuerySchema.parse(flat);
  const [data, categories, orgs, upazilas] = await Promise.all([
    listLedger(user, q),
    prisma.reliefCategory.findMany({ orderBy: { code: 'asc' } }),
    prisma.organization.findMany({ orderBy: { name: 'asc' } }),
    prisma.area.findMany({ where: { level: 'UPAZILA' }, orderBy: { name: 'asc' } }),
  ]);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const pageLink = (page: number) => `/distributions?${new URLSearchParams({ ...flat, page: String(page) })}`;

  return (
    <div className="stack">
      <h1>{user.role === 'VOLUNTEER' ? 'আমার বিতরণ' : 'কেন্দ্রীয় বিতরণ লেজার'}</h1>
      {user.role !== 'VOLUNTEER' && <p className="hint">সব সংস্থার সব বিতরণ এক জায়গায়। কার্ড কোড দিয়ে নিশ্চিত না হলে কোনো বিতরণ &quot;নিশ্চিত&quot; গণ্য হয় না।</p>}

      <section className="grid" aria-label="সারসংক্ষেপ">
        {data.delivered.map((d) => {
          const c = catById.get(d.categoryId);
          return (
            <div key={d.categoryId} className="card">
              <div className="hint">{c?.nameBn} — নিশ্চিত বিতরণ</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{bn(d._sum.quantity ?? 0)} {c?.unit}</div>
              <div className="hint">{bn(d._count._all)}টি বিতরণ</div>
            </div>
          );
        })}
        <div className="card">
          <div className="hint">অবস্থা অনুযায়ী</div>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {data.byStatus.map((s) => (
              <li key={s.status}>{STATUS_BN[s.status as DistStatus]}: {bn(typeof s._count === 'object' && s._count ? (s._count._all ?? 0) : 0)}</li>
            ))}
          </ul>
        </div>
      </section>

      <form method="get" className="card filters" role="search" aria-label="বিতরণ খুঁজুন">
        <div>
          <label htmlFor="q">পরিবারের নাম</label>
          <input id="q" name="q" type="search" defaultValue={q.q ?? ''} />
        </div>
        <div>
          <label htmlFor="status">অবস্থা</label>
          <select id="status" name="status" defaultValue={q.status ?? ''}>
            <option value="">সব</option>
            {Object.entries(STATUS_BN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="categoryId">ত্রাণের ধরন</label>
          <select id="categoryId" name="categoryId" defaultValue={q.categoryId ?? ''}>
            <option value="">সব</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.nameBn}</option>)}
          </select>
        </div>
        {user.role !== 'VOLUNTEER' && (
          <>
            <div>
              <label htmlFor="orgId">সংস্থা</label>
              <select id="orgId" name="orgId" defaultValue={q.orgId ?? ''}>
                <option value="">সব</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.nameBn}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="upazilaId">উপজেলা</label>
              <select id="upazilaId" name="upazilaId" defaultValue={q.upazilaId ?? ''}>
                <option value="">সব</option>
                {upazilas.map((a) => <option key={a.id} value={a.id}>{a.nameBn}</option>)}
              </select>
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="submit">প্রয়োগ করুন</button>
          <Link href="/distributions" className="btn btn-secondary">মুছুন</Link>
        </div>
      </form>

      <p aria-live="polite"><strong>{bn(data.total)}</strong>টি বিতরণ</p>
      <div className="table-wrap">
        <table>
          <caption className="visually-hidden">বিতরণের তালিকা</caption>
          <thead>
            <tr>
              <th scope="col">সময়</th>
              <th scope="col">পরিবার</th>
              <th scope="col">ত্রাণ</th>
              <th scope="col">অবস্থা</th>
              <th scope="col" className="hide-sm">সংস্থা / কর্মী</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && <tr><td colSpan={5}>কোনো বিতরণ পাওয়া যায়নি।</td></tr>}
            {data.rows.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.occurredAt.toLocaleString('bn-BD', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  {d.createdOffline && <div><span className="badge">অফলাইনে</span></div>}
                </td>
                <td>
                  <Link href={`/households/${d.household.id}`}>{d.household.headName}</Link>
                  <div className="hint">{d.household.ward.parent?.nameBn}, {d.household.ward.nameBn}</div>
                </td>
                <td>{d.category.nameBn} × {bn(d.quantity)} {d.category.unit}{d.overrideReason && <div className="hint">ব্যতিক্রমের কারণ: {d.overrideReason}</div>}</td>
                <td>
                  <span className={`badge ${d.status === 'DELIVERED' ? '' : d.status === 'FAILED' || d.status === 'EXPIRED' ? 'badge-danger' : 'badge-warn'}`}>
                    {STATUS_BN[d.status as DistStatus]}
                  </span>
                  {(d.status === 'AWAITING_CONFIRMATION' || d.status === 'EXPIRED') && <ConfirmDistribution id={d.id} />}
                </td>
                <td className="hide-sm">{d.org.nameBn}<div className="hint">{d.volunteer.name}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav className="pager" aria-label="পাতা">
        <span>পাতা {bn(data.page)} / {bn(data.pages)}</span>
        <span style={{ display: 'flex', gap: '0.5rem' }}>
          {data.page > 1 && <Link className="btn btn-secondary" href={pageLink(data.page - 1)}>← আগের</Link>}
          {data.page < data.pages && <Link className="btn btn-secondary" href={pageLink(data.page + 1)}>পরের →</Link>}
        </span>
      </nav>
    </div>
  );
}
