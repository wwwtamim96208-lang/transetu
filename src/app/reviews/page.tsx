import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { FLAG_BN, listReviews } from '@/lib/reviews';
import { DUP_REASON_BN, type DupReason } from '@/lib/domain/duplicate';
import { ResolveReview } from '@/components/ResolveReview';

const TYPE_BN = { DUPLICATE_HOUSEHOLD: 'সম্ভাব্য একই পরিবার', REPEAT_RELIEF: 'বারবার ত্রাণ', SYNC_CONFLICT: 'Sync সমস্যা' } as const;
const fmt = (d: Date | string) => new Date(d).toLocaleString('bn-BD', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

type Details = {
  level?: string; reasons?: DupReason[]; relatedName?: string; userReason?: string | null;
  flags?: string[]; overrideReason?: string | null; createdOffline?: boolean;
  others?: { occurredAt: string; quantity: number; org: string; volunteer: string; offline: boolean }[];
};

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/reviews');
  if (user.role === 'VOLUNTEER') redirect('/field');
  const sp = await searchParams;
  const status = sp.status === 'RESOLVED' || sp.status === 'DISMISSED' ? sp.status : 'OPEN';
  const items = await listReviews(user, status);

  return (
    <div className="stack">
      <h1>যাচাইয়ের তালিকা</h1>
      <p className="hint">সিস্টেম যেগুলো নিজে সিদ্ধান্ত নিতে পারেনি: সম্ভাব্য একই পরিবার, বারবার ত্রাণ, অফলাইন sync-এর সংঘাত।</p>
      <nav style={{ display: 'flex', gap: '0.5rem' }} aria-label="অবস্থা">
        {(['OPEN', 'RESOLVED', 'DISMISSED'] as const).map((s) => (
          <Link key={s} href={`/reviews?status=${s}`} className={`btn ${s === status ? '' : 'btn-secondary'}`} aria-current={s === status ? 'page' : undefined}>
            {s === 'OPEN' ? 'খোলা' : s === 'RESOLVED' ? 'সমাধান হয়েছে' : 'বাতিল'}
          </Link>
        ))}
      </nav>
      {items.length === 0 && <p>এই তালিকায় কিছু নেই।</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} className="stack">
        {items.map((r) => {
          const d = r.details as unknown as Details;
          return (
            <li key={r.id} className="card stack">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span><span className="badge badge-warn">{TYPE_BN[r.type]}</span> <Link href={`/households/${r.household.id}`}>{r.household.headName}</Link> <span className="hint">· {r.household.ward.nameBn}</span></span>
                <span className="hint">{fmt(r.createdAt)}</span>
              </div>

              {r.type === 'DUPLICATE_HOUSEHOLD' && (
                <p style={{ margin: 0 }}>
                  মিল: {r.relatedHousehold ? <Link href={`/households/${r.relatedHousehold.id}`}>{r.relatedHousehold.headName}</Link> : d.relatedName}
                  {r.relatedHousehold && <span className="hint"> ({r.relatedHousehold.ward.nameBn})</span>} — {(d.reasons ?? []).map((x) => DUP_REASON_BN[x]).join(', ')}
                  {d.userReason && <><br />নিবন্ধনকারীর ব্যাখ্যা: “{d.userReason}”</>}
                </p>
              )}

              {r.distribution && (
                <p style={{ margin: 0 }}>
                  এই বিতরণ: {r.distribution.category.nameBn} × {r.distribution.quantity} — {r.distribution.org.nameBn} ({r.distribution.volunteer.name}), {fmt(r.distribution.occurredAt)}
                  {r.distribution.createdOffline && ' · অফলাইনে'}
                </p>
              )}
              {r.type === 'REPEAT_RELIEF' && (
                <div>
                  একই সময়ে আগের/অন্য বিতরণ:
                  <ul>
                    {(d.others ?? []).map((o, i) => (
                      <li key={i}>{o.org} ({o.volunteer}) — {fmt(o.occurredAt)}, পরিমাণ {o.quantity}{o.offline ? ' · অফলাইনে' : ''}</li>
                    ))}
                  </ul>
                  {d.overrideReason ? <p style={{ margin: 0 }}>কর্মী সতর্কতা দেখে কারণ লিখেছেন: “{d.overrideReason}”</p> : <p style={{ margin: 0 }}><strong>কর্মী সতর্কতা দেখেননি</strong> (সম্ভবত দুজনই অফলাইনে ছিলেন)।</p>}
                </div>
              )}
              {d.flags && d.flags.length > 0 && (
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {d.flags.map((f) => <span key={f} className="badge badge-danger">{FLAG_BN[f] ?? f}</span>)}
                </div>
              )}

              {r.status === 'OPEN' ? <ResolveReview id={r.id} /> : <p className="hint" style={{ margin: 0 }}>সিদ্ধান্ত: {r.resolution}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
