import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { stockOverview } from '@/lib/stock';
import { AllotForm, CloseAllotmentButton, ReceiveForm } from '@/components/StockForms';

const bn = (n: number) => n.toLocaleString('bn-BD');

export default async function StockPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/stock');
  if (user.role === 'VOLUNTEER') redirect('/field');
  const data = await stockOverview(user);

  return (
    <div className="stack">
      <h1>স্টক ও বরাদ্দ</h1>
      <p className="hint">মাঠে যাওয়ার আগে স্বেচ্ছাসেবীকে নির্দিষ্ট পরিমাণ ত্রাণ বরাদ্দ দিন। অফলাইনে তিনি এর বেশি বিতরণ করতে পারবেন না।</p>

      <section className="card stack" aria-labelledby="st-h">
        <h2 id="st-h" style={{ marginTop: 0 }}>গুদামে মজুদ</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">উপজেলা</th><th scope="col">ত্রাণ</th><th scope="col">মজুদ</th>{user.role === 'ADMIN' && <th scope="col">সংস্থা</th>}</tr></thead>
            <tbody>
              {data.stocks.length === 0 && <tr><td colSpan={4}>কোনো মজুদ নেই।</td></tr>}
              {data.stocks.map((s) => (
                <tr key={s.id}>
                  <td>{s.area.nameBn}</td>
                  <td>{s.category.nameBn}</td>
                  <td>{bn(s.quantity)} {s.category.unit}</td>
                  {user.role === 'ADMIN' && <td>{s.org.nameBn}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid">
        <AllotForm
          stocks={data.stocks.map((s) => ({ id: s.id, label: `${s.area.nameBn} · ${s.category.nameBn} (${s.quantity} ${s.category.unit})`, orgId: s.orgId, areaId: s.areaId }))}
          volunteers={data.volunteers.map((v) => ({ id: v.id, label: `${v.name} — ${v.area?.nameBn ?? 'এলাকা নেই'}`, orgId: v.orgId, upazilaId: v.area?.parentId ?? null }))}
        />
        <ReceiveForm
          categories={data.categories.map((c) => ({ id: c.id, label: `${c.nameBn} (${c.unit})` }))}
          upazilas={data.upazilas.map((a) => ({ id: a.id, label: a.nameBn }))}
          orgs={data.orgs.map((o) => ({ id: o.id, label: o.nameBn }))}
        />
      </div>

      <section className="card stack" aria-labelledby="al-h">
        <h2 id="al-h" style={{ marginTop: 0 }}>স্বেচ্ছাসেবীদের বরাদ্দ</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">স্বেচ্ছাসেবী</th><th scope="col">ত্রাণ</th><th scope="col">বাকি / মোট</th><th scope="col">অবস্থা</th></tr></thead>
            <tbody>
              {data.allotments.length === 0 && <tr><td colSpan={4}>কোনো বরাদ্দ নেই।</td></tr>}
              {data.allotments.map((a) => (
                <tr key={a.id}>
                  <td>{a.volunteer.name}<div className="hint">{a.volunteer.area?.nameBn}</div></td>
                  <td>{a.stock.category.nameBn}<div className="hint">{a.stock.area.nameBn}</div></td>
                  <td>{bn(a.remaining)} / {bn(a.quantity)} {a.stock.category.unit}</td>
                  <td>
                    {a.status === 'ACTIVE' ? <><span className="badge">সক্রিয়</span> <CloseAllotmentButton id={a.id} /></> : <span className="badge">বন্ধ</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
