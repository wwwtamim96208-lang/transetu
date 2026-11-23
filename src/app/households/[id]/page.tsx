import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { HttpError } from '@/lib/http';
import { getHousehold, listAreas } from '@/lib/households';
import { HouseholdForm } from '@/components/HouseholdForm';
import { DeleteHousehold } from '@/components/DeleteHousehold';

const DAMAGE_BN = { NONE: 'নেই', PARTIAL: 'আংশিক', SEVERE: 'গুরুতর', TOTAL: 'সম্পূর্ণ' } as const;
const GENDER_BN = { MALE: 'পুরুষ', FEMALE: 'নারী', OTHER: 'অন্যান্য' } as const;

export default async function HouseholdPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const { id } = await params;
  if (!user) redirect(`/login?next=/households/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const h = await getHousehold(user, id).catch((e: unknown) => {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  });
  const areas = h.canEdit ? await listAreas() : [];

  return (
    <div className="stack">
      <p className="no-print"><Link href="/households">← পরিবার তালিকা</Link></p>
      <h1>{h.headName}</h1>

      <section className="card">
        <dl className="grid" style={{ margin: 0 }}>
          <div><dt className="hint">এলাকা</dt><dd style={{ margin: 0 }}>{h.upazilaName}, {h.unionName}, {h.wardName}</dd></div>
          <div><dt className="hint">ফোন</dt><dd style={{ margin: 0 }}>{h.phone ?? 'নেই'}</dd></div>
          <div><dt className="hint">NID</dt><dd style={{ margin: 0 }}>{h.nidMasked ?? 'নেই'}</dd></div>
          <div><dt className="hint">সদস্য</dt><dd style={{ margin: 0 }}>{h.memberCount.toLocaleString('bn-BD')} জন{h.femaleHeaded ? ' · নারী-প্রধান' : ''}</dd></div>
          <div><dt className="hint">ক্ষতির মাত্রা</dt><dd style={{ margin: 0 }}>{DAMAGE_BN[h.damageLevel]}</dd></div>
          <div><dt className="hint">নিবন্ধনকারী সংস্থা</dt><dd style={{ margin: 0 }}>{h.orgName}</dd></div>
        </dl>
        {h.members.length > 0 && (
          <>
            <h2>বিশেষ বিবেচনার সদস্য</h2>
            <ul>
              {h.members.map((m) => (
                <li key={m.id}>
                  {m.name ?? 'নাম নেই'} — {m.age.toLocaleString('bn-BD')} বছর, {GENDER_BN[m.gender]}
                  {m.disability && ' · প্রতিবন্ধী'}{m.chronicIllness && ' · দীর্ঘমেয়াদি অসুস্থ'}{m.pregnant && ' · গর্ভবতী'}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {h.canEdit ? (
        <section className="stack no-print">
          <h2>তথ্য সম্পাদনা</h2>
          <HouseholdForm areas={areas} initial={h} restrictToUnionId={user.role === 'VOLUNTEER' ? user.areaId : null} />
        </section>
      ) : (
        <p className="hint">এই পরিবারের তথ্য সম্পাদনার অনুমতি শুধু নিবন্ধনকারী সংস্থা ও প্রশাসকের আছে।</p>
      )}

      {h.canDelete && <DeleteHousehold id={h.id} />}
    </div>
  );
}
