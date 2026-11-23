'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AreaDTO, HouseholdDTO } from '@/lib/households';

type Gender = 'MALE' | 'FEMALE' | 'OTHER';
type Damage = 'NONE' | 'PARTIAL' | 'SEVERE' | 'TOTAL';
type MemberRow = { key: string; name: string; age: string; gender: Gender; disability: boolean; chronicIllness: boolean; pregnant: boolean };
type Match = {
  householdId: string; level: 'BLOCK' | 'FLAG' | 'REVIEW'; headName: string; areaName: string;
  phoneMasked: string | null; reasonText: string[]; deleted: boolean; visible: boolean;
};
type FieldErrors = Record<string, string[] | undefined>;

const LEVEL_BN = { BLOCK: 'নিবন্ধন বন্ধ', FLAG: 'নিশ্চিত করতে হবে', REVIEW: 'যাচাইয়ের জন্য পাঠানো হবে' } as const;
const newKey = () => Math.random().toString(36).slice(2);

interface Props {
  areas: AreaDTO[];
  initial?: HouseholdDTO;
  restrictToUnionId: string | null;
}

export function HouseholdForm({ areas, initial, restrictToUnionId }: Props) {
  const router = useRouter();
  const isEdit = !!initial;
  // Client-generated id makes retries/double-clicks idempotent on the server.
  const idRef = useRef<string | null>(null);
  if (!idRef.current) idRef.current = initial?.id ?? crypto.randomUUID();

  const [headName, setHeadName] = useState(initial?.headName ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [nid, setNid] = useState('');
  const [wardId, setWardId] = useState(initial?.wardId ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [memberCount, setMemberCount] = useState(String(initial?.memberCount ?? ''));
  const [femaleHeaded, setFemaleHeaded] = useState(initial?.femaleHeaded ?? false);
  const [damageLevel, setDamageLevel] = useState<Damage>(initial?.damageLevel ?? 'PARTIAL');
  const [members, setMembers] = useState<MemberRow[]>(
    (initial?.members ?? []).map((m) => ({
      key: m.id, name: m.name ?? '', age: String(m.age), gender: m.gender,
      disability: m.disability, chronicIllness: m.chronicIllness, pregnant: m.pregnant,
    })),
  );
  const [version, setVersion] = useState(initial?.version ?? 1);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [liveMatches, setLiveMatches] = useState<Match[]>([]);
  const [submitMatches, setSubmitMatches] = useState<Match[]>([]);
  const [needConfirm, setNeedConfirm] = useState(false);
  const [confirmDup, setConfirmDup] = useState(false);
  const [dupReason, setDupReason] = useState('');
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<{ id: string; cardCode: string; headName: string; ward: string; warnings: Match[] } | null>(null);

  // Ward options grouped by union, limited for volunteers.
  const groups = useMemo(() => {
    const byId = new Map(areas.map((a) => [a.id, a]));
    return areas
      .filter((a) => a.level === 'UNION' && (!restrictToUnionId || a.id === restrictToUnionId))
      .map((u) => ({
        label: `${byId.get(u.parentId ?? '')?.nameBn ?? ''} › ${u.nameBn}`,
        wards: areas.filter((w) => w.level === 'WARD' && w.parentId === u.id),
      }));
  }, [areas, restrictToUnionId]);
  const wardLabel = useMemo(() => areas.find((a) => a.id === wardId)?.nameBn ?? '', [areas, wardId]);

  // Identity changed after a rejected submit: old warnings no longer apply.
  useEffect(() => {
    setSubmitMatches([]);
    setNeedConfirm(false);
    setConfirmDup(false);
  }, [headName, phone, nid, wardId]);

  // Live duplicate check (debounced) while the volunteer types.
  useEffect(() => {
    if (!wardId || headName.trim().length < 2) {
      setLiveMatches([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/households/check-duplicate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ headName, phone: phone || undefined, nid: nid || undefined, wardId, excludeId: initial?.id }),
          signal: ctrl.signal,
        });
        if (res.ok) setLiveMatches((await res.json()).matches);
      } catch {
        /* offline or aborted: the server checks again on submit */
      }
    }, 600);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [headName, phone, nid, wardId, initial?.id]);

  function updateMember(key: string, patch: Partial<MemberRow>) {
    setMembers((ms) => ms.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  }

  function clientValidate(): FieldErrors {
    const e: FieldErrors = {};
    if (headName.trim().length < 2) e.headName = ['পরিবার প্রধানের নাম লিখুন'];
    if (!wardId) e.wardId = ['ওয়ার্ড নির্বাচন করুন'];
    const mc = Number(memberCount);
    if (!memberCount || !Number.isInteger(mc) || mc < 1 || mc > 30) e.memberCount = ['১ থেকে ৩০-এর মধ্যে সংখ্যা দিন'];
    if (members.length > (mc || 0)) e.members = ['বিশেষ সদস্যের সংখ্যা মোট সদস্যের বেশি হতে পারে না'];
    if (members.some((m) => m.age === '' || Number(m.age) < 0 || Number(m.age) > 120)) e.members = ['প্রত্যেক সদস্যের সঠিক বয়স দিন'];
    if (members.some((m) => m.pregnant && (m.gender !== 'FEMALE' || Number(m.age) < 12 || Number(m.age) > 55))) {
      e.members = ['গর্ভবতী শুধু ১২–৫৫ বছর বয়সী নারী সদস্যের জন্য প্রযোজ্য'];
    }
    if (needConfirm && confirmDup && dupReason.trim().length < 10) e.duplicateReason = ['কমপক্ষে ১০ অক্ষরে কারণ লিখুন'];
    return e;
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (pending) return; // duplicate-click guard (server is idempotent as well)
    setSuccess(null);
    setServerError(null);
    const ce = clientValidate();
    setErrors(ce);
    if (Object.keys(ce).length) {
      setServerError('লাল চিহ্নিত ঘরগুলো ঠিক করুন।');
      return;
    }

    setPending(true);
    const body = {
      ...(isEdit ? { version } : { id: idRef.current }),
      headName, phone: phone || undefined, nid: nid || undefined, wardId,
      address: address || undefined, memberCount: Number(memberCount), femaleHeaded, damageLevel,
      members: members.map((m) => ({
        name: m.name || undefined, age: Number(m.age), gender: m.gender,
        disability: m.disability, chronicIllness: m.chronicIllness, pregnant: m.pregnant,
      })),
      confirmDuplicate: needConfirm && confirmDup ? true : undefined,
      duplicateReason: needConfirm && confirmDup ? dupReason : undefined,
    };

    try {
      const res = await fetch(isEdit ? `/api/households/${initial!.id}` : '/api/households', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);

      if (res.ok) {
        if (isEdit) {
          setVersion(data.household.version);
          setNid('');
          setNeedConfirm(false);
          setConfirmDup(false);
          setDupReason('');
          setSuccess('তথ্য সংরক্ষিত হয়েছে।');
          router.refresh();
        } else {
          setCreated({ id: data.household.id, cardCode: data.cardCode, headName, ward: wardLabel, warnings: data.warnings ?? [] });
        }
      } else if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
        return;
      } else {
        const err = data?.error;
        setServerError(err?.message ?? 'সংরক্ষণ করা যায়নি।');
        if (err?.code === 'DUPLICATE_WARNING') {
          setSubmitMatches(err.details.matches);
          setNeedConfirm(true);
        } else if (err?.code === 'DUPLICATE_BLOCKED') {
          setSubmitMatches(err.details?.matches ?? []);
          setNeedConfirm(false);
        } else if (err?.code === 'VALIDATION_ERROR' && err.details) {
          setErrors(err.details);
        }
      }
    } catch {
      setServerError('সার্ভারে সংযোগ করা যাচ্ছে না। ইন্টারনেট সংযোগ দেখে আবার "সংরক্ষণ" চাপুন। একই তথ্য দুবার জমা হবে না।');
    }
    setPending(false);
  }

  // ---------- success screen with printable token card ----------
  if (created) {
    return (
      <div className="stack">
        <div className="alert alert-ok no-print" role="status">পরিবার নিবন্ধিত হয়েছে। নিচের টোকেন কার্ডটি প্রিন্ট করে পরিবারকে দিন।</div>
        {created.warnings.length > 0 && (
          <div className="alert alert-warn no-print">সম্ভাব্য মিলের কারণে {created.warnings.length}টি বিষয় সমন্বয়কারীর যাচাইয়ের তালিকায় পাঠানো হয়েছে।</div>
        )}
        <div className="code-card">
          <div><strong>ত্রাণসেতু · টোকেন কার্ড</strong></div>
          <div style={{ margin: '0.5rem 0' }}>{created.headName}<br /><span className="hint">{created.ward}</span></div>
          <div className="code" aria-label={`কোড ${created.cardCode.split('').join(' ')}`}>{created.cardCode}</div>
          <div className="hint">ত্রাণ নেওয়ার সময় এই কোড দেখাতে হবে। কাউকে আগে থেকে বলবেন না।</div>
        </div>
        <div className="no-print" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => window.print()}>প্রিন্ট করুন</button>
          <a className="btn btn-secondary" href={`/households/${created.id}`}>পরিবারের পাতা</a>
          <a className="btn btn-secondary" href="/households/new">আরেকটি নিবন্ধন</a>
        </div>
      </div>
    );
  }

  const err = (k: string) => errors[k]?.[0];
  const shownMatches = submitMatches.length ? submitMatches : liveMatches;

  return (
    <form onSubmit={onSubmit} className="card stack" noValidate>
      <div role="alert" aria-live="assertive">
        {serverError && <div className="alert alert-error">{serverError}</div>}
      </div>
      <div role="status" aria-live="polite">
        {success && <div className="alert alert-ok">{success}</div>}
      </div>

      <div className="grid">
        <div>
          <label htmlFor="headName">পরিবার প্রধানের নাম *</label>
          <input id="headName" type="text" value={headName} onChange={(e) => setHeadName(e.target.value)}
            aria-invalid={!!err('headName')} aria-describedby="headName-err" autoComplete="off" />
          <div id="headName-err" className="field-error">{err('headName')}</div>
        </div>
        <div>
          <label htmlFor="wardId">ওয়ার্ড *</label>
          <select id="wardId" value={wardId} onChange={(e) => setWardId(e.target.value)} aria-invalid={!!err('wardId')} aria-describedby="wardId-err">
            <option value="">নির্বাচন করুন</option>
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.wards.map((w) => <option key={w.id} value={w.id}>{w.nameBn}</option>)}
              </optgroup>
            ))}
          </select>
          <div id="wardId-err" className="field-error">{err('wardId')}</div>
        </div>
        <div>
          <label htmlFor="phone">মোবাইল নম্বর <span className="hint">(না থাকলে ফাঁকা রাখুন)</span></label>
          <input id="phone" type="text" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            aria-invalid={!!err('phone')} aria-describedby="phone-err" placeholder="01XXXXXXXXX" />
          <div id="phone-err" className="field-error">{err('phone')}</div>
        </div>
        <div>
          <label htmlFor="nid">NID নম্বর <span className="hint">{isEdit ? (initial?.hasNid ? `(সংরক্ষিত: ${initial.nidMasked}; বদলাতে না চাইলে ফাঁকা রাখুন)` : '(ঐচ্ছিক)') : '(ঐচ্ছিক)'}</span></label>
          <input id="nid" type="text" inputMode="numeric" value={nid} onChange={(e) => setNid(e.target.value)}
            aria-invalid={!!err('nid')} aria-describedby="nid-err" autoComplete="off" />
          <div id="nid-err" className="field-error">{err('nid')}</div>
        </div>
        <div>
          <label htmlFor="memberCount">মোট সদস্য *</label>
          <input id="memberCount" type="number" min={1} max={30} value={memberCount} onChange={(e) => setMemberCount(e.target.value)}
            aria-invalid={!!err('memberCount')} aria-describedby="memberCount-err" />
          <div id="memberCount-err" className="field-error">{err('memberCount')}</div>
        </div>
        <div>
          <label htmlFor="damageLevel">ঘরবাড়ির ক্ষতি *</label>
          <select id="damageLevel" value={damageLevel} onChange={(e) => setDamageLevel(e.target.value as Damage)}>
            <option value="NONE">ক্ষতি নেই</option>
            <option value="PARTIAL">আংশিক</option>
            <option value="SEVERE">গুরুতর</option>
            <option value="TOTAL">সম্পূর্ণ ধ্বংস</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="address">ঠিকানা / চেনার উপায়</label>
        <input id="address" type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="যেমন: মসজিদের পাশে, পূর্ব পাড়া" />
      </div>

      <label className="check" htmlFor="femaleHeaded">
        <input id="femaleHeaded" type="checkbox" checked={femaleHeaded} onChange={(e) => setFemaleHeaded(e.target.checked)} />
        নারী-প্রধান পরিবার
      </label>

      {/* Duplicate warnings */}
      <div aria-live="polite">
        {shownMatches.length > 0 && (
          <div className={`alert ${shownMatches.some((m) => m.level !== 'REVIEW') ? 'alert-error' : 'alert-warn'}`}>
            <strong>সম্ভাব্য একই পরিবার পাওয়া গেছে:</strong>
            <ul>
              {shownMatches.map((m, i) => (
                <li key={`${m.householdId}-${i}`}>
                  {m.visible && m.householdId ? <a href={`/households/${m.householdId}`} target="_blank" rel="noreferrer">{m.headName}</a> : m.headName}
                  {' '}({m.areaName}{m.phoneMasked ? `, ${m.phoneMasked}` : ''}) — {m.reasonText.join(', ')}{' '}
                  <span className={`badge ${m.level === 'BLOCK' ? 'badge-danger' : 'badge-warn'}`}>{LEVEL_BN[m.level]}</span>
                  {m.deleted && <span className="badge"> মুছে ফেলা</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {needConfirm && (
        <fieldset className="card stack">
          <legend>নিশ্চিতকরণ</legend>
          <label className="check" htmlFor="confirmDup">
            <input id="confirmDup" type="checkbox" checked={confirmDup} onChange={(e) => setConfirmDup(e.target.checked)} />
            আমি যাচাই করেছি, এটি আলাদা পরিবার
          </label>
          {confirmDup && (
            <div>
              <label htmlFor="dupReason">কারণ *</label>
              <input id="dupReason" type="text" value={dupReason} onChange={(e) => setDupReason(e.target.value)}
                aria-invalid={!!err('duplicateReason')} aria-describedby="dupReason-err" placeholder="যেমন: দুই ভাই, একই ফোন ব্যবহার করে, আলাদা ঘর" />
              <div id="dupReason-err" className="field-error">{err('duplicateReason')}</div>
            </div>
          )}
        </fieldset>
      )}

      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend><strong>বিশেষ বিবেচনার সদস্য</strong> <span className="hint">— বয়স্ক, শিশু, প্রতিবন্ধী, অসুস্থ বা গর্ভবতী সদস্যদের যোগ করুন</span></legend>
        <div className="field-error" role="alert">{err('members')}</div>
        {members.map((m, i) => (
          <div key={m.key} className="member-row">
            <div className="grid">
              <div>
                <label htmlFor={`m-name-${m.key}`}>নাম <span className="hint">(ঐচ্ছিক)</span></label>
                <input id={`m-name-${m.key}`} type="text" value={m.name} onChange={(e) => updateMember(m.key, { name: e.target.value })} />
              </div>
              <div>
                <label htmlFor={`m-age-${m.key}`}>বয়স *</label>
                <input id={`m-age-${m.key}`} type="number" min={0} max={120} value={m.age} onChange={(e) => updateMember(m.key, { age: e.target.value })} />
              </div>
              <div>
                <label htmlFor={`m-gender-${m.key}`}>লিঙ্গ</label>
                <select id={`m-gender-${m.key}`} value={m.gender} onChange={(e) => updateMember(m.key, { gender: e.target.value as Gender })}>
                  <option value="FEMALE">নারী</option>
                  <option value="MALE">পুরুষ</option>
                  <option value="OTHER">অন্যান্য</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              <label className="check"><input type="checkbox" checked={m.disability} onChange={(e) => updateMember(m.key, { disability: e.target.checked })} /> প্রতিবন্ধী</label>
              <label className="check"><input type="checkbox" checked={m.chronicIllness} onChange={(e) => updateMember(m.key, { chronicIllness: e.target.checked })} /> দীর্ঘমেয়াদি অসুস্থ</label>
              <label className="check"><input type="checkbox" checked={m.pregnant} onChange={(e) => updateMember(m.key, { pregnant: e.target.checked })} /> গর্ভবতী</label>
              <button type="button" className="btn-link" onClick={() => setMembers((ms) => ms.filter((x) => x.key !== m.key))} aria-label={`সদস্য ${i + 1} বাদ দিন`}>বাদ দিন</button>
            </div>
          </div>
        ))}
        <div>
          <button type="button" className="btn btn-secondary"
            onClick={() => setMembers((ms) => [...ms, { key: newKey(), name: '', age: '', gender: 'FEMALE', disability: false, chronicIllness: false, pregnant: false }])}>
            + সদস্য যোগ করুন
          </button>
        </div>
      </fieldset>

      <div>
        <button type="submit" disabled={pending}>{pending ? 'সংরক্ষণ হচ্ছে…' : isEdit ? 'পরিবর্তন সংরক্ষণ' : 'নিবন্ধন করুন'}</button>
      </div>
    </form>
  );
}
