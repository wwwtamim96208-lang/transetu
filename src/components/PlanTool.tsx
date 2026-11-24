'use client';

import { useMemo, useState } from 'react';
import type { PlanResult, MustFlag } from '@/lib/domain/allocate';
import { MUST_BN, UNCOVERED_BN } from '@/lib/domain/allocate';
import { bnNum } from '@/lib/domain/format';

type Opt = { id: string; label: string };
type FieldErrors = Record<string, string[] | undefined>;

interface Props {
  categories: (Opt & { unit: string })[];
  unions: (Opt & { upazilaId: string })[];
  stocks: { id: string; categoryId: string; areaId: string; quantity: number; orgName: string }[];
  volunteers: (Opt & { areaId: string | null; orgId: string })[];
}

const FLAGS = Object.keys(MUST_BN) as MustFlag[];

export function PlanTool({ categories, unions, stocks, volunteers }: Props) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [unionId, setUnionId] = useState(unions[0]?.id ?? '');
  const [stockId, setStockId] = useState('');
  const [useQuantity, setUseQuantity] = useState('');
  const [skipCooldown, setSkipCooldown] = useState(true);
  const [mustInclude, setMustInclude] = useState<MustFlag[]>([]);
  const [cap, setCap] = useState('');
  const [allowPartial, setAllowPartial] = useState(false);
  const [maxHouseholds, setMaxHouseholds] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<{ result: PlanResult; unit: string; stockId: string; categoryId: string; unionId: string } | null>(null);
  const [volunteerId, setVolunteerId] = useState('');
  const [applied, setApplied] = useState<string | null>(null);

  const union = unions.find((u) => u.id === unionId);
  const matchingStocks = useMemo(
    () => stocks.filter((s) => s.categoryId === categoryId && s.areaId === union?.upazilaId),
    [stocks, categoryId, union],
  );
  const effectiveStockId = matchingStocks.some((s) => s.id === stockId) ? stockId : matchingStocks[0]?.id ?? '';
  const unit = categories.find((c) => c.id === categoryId)?.unit ?? '';

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setErrors({});
    setApplied(null);
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId, unionId, stockId: effectiveStockId, useQuantity, skipCooldown, mustInclude,
          perHouseholdCap: cap, allowPartial, maxHouseholds,
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        setPlan({ result: body.result, unit, stockId: effectiveStockId, categoryId, unionId });
        setVolunteerId('');
      } else {
        setPlan(null);
        setError(body?.error?.message ?? 'পরিকল্পনা করা যায়নি।');
        if (body?.error?.details) setErrors(body.error.details);
      }
    } catch {
      setError('সার্ভারে সংযোগ করা যাচ্ছে না।');
    }
    setBusy(false);
  }

  async function apply() {
    if (!plan || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/plan/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stockId: plan.stockId, volunteerId, categoryId: plan.categoryId, unionId: plan.unionId,
          lines: plan.result.lines.map((l) => ({ householdId: l.householdId, qty: l.qty })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) setApplied(`${bnNum(body.total)} ${plan.unit} স্বেচ্ছাসেবীকে বরাদ্দ দেওয়া হয়েছে। মাঠের ফোনে ডেটা আপডেট করলেই দেখা যাবে।`);
      else setError(body?.error?.details?.volunteerId?.[0] ?? body?.error?.message ?? 'বরাদ্দ দেওয়া যায়নি।');
    } catch {
      setError('সার্ভারে সংযোগ করা যাচ্ছে না।');
    }
    setBusy(false);
  }

  const r = plan?.result;
  const eligibleVols = volunteers.filter((v) => v.areaId === plan?.unionId);

  return (
    <div className="stack">
      <form onSubmit={run} className="card stack" noValidate aria-label="পরিকল্পনার শর্ত">
        <div className="grid">
          <div>
            <label htmlFor="p-cat">ত্রাণের ধরন</label>
            <select id="p-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-invalid={!!errors.categoryId}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="p-union">ইউনিয়ন</label>
            <select id="p-union" value={unionId} onChange={(e) => setUnionId(e.target.value)} aria-invalid={!!errors.unionId}>
              {unions.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="p-stock">মজুদ</label>
            <select id="p-stock" value={effectiveStockId} onChange={(e) => setStockId(e.target.value)} aria-invalid={!!errors.stockId} aria-describedby="p-stock-err">
              {matchingStocks.length === 0 && <option value="">এই উপজেলায় এই ত্রাণের মজুদ নেই</option>}
              {matchingStocks.map((s) => <option key={s.id} value={s.id}>{s.orgName}: {bnNum(s.quantity)} {unit}</option>)}
            </select>
            <div id="p-stock-err" className="field-error">{errors.stockId?.[0]}</div>
          </div>
          <div>
            <label htmlFor="p-use">এর মধ্যে ব্যবহার করবেন <span className="hint">(ফাঁকা = সব)</span></label>
            <input id="p-use" type="number" min={1} value={useQuantity} onChange={(e) => setUseQuantity(e.target.value)} aria-invalid={!!errors.useQuantity} />
            <div className="field-error">{errors.useQuantity?.[0]}</div>
          </div>
          <div>
            <label htmlFor="p-cap">পরিবারপ্রতি সর্বোচ্চ <span className="hint">(ঐচ্ছিক)</span></label>
            <input id="p-cap" type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} aria-invalid={!!errors.perHouseholdCap} />
            <div className="field-error">{errors.perHouseholdCap?.[0]}</div>
          </div>
          <div>
            <label htmlFor="p-max">সর্বোচ্চ কয়টি পরিবার <span className="hint">(যেমন এক নৌকায়)</span></label>
            <input id="p-max" type="number" min={1} value={maxHouseholds} onChange={(e) => setMaxHouseholds(e.target.value)} aria-invalid={!!errors.maxHouseholds} />
            <div className="field-error">{errors.maxHouseholds?.[0]}</div>
          </div>
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend><strong>অবশ্যই আগে দিতে হবে যদি পরিবারে…</strong></legend>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {FLAGS.map((f) => (
              <label key={f} className="check">
                <input type="checkbox" checked={mustInclude.includes(f)}
                  onChange={(e) => setMustInclude((m) => (e.target.checked ? [...m, f] : m.filter((x) => x !== f)))} />
                {MUST_BN[f]}
              </label>
            ))}
          </div>
        </fieldset>

        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <label className="check"><input type="checkbox" checked={skipCooldown} onChange={(e) => setSkipCooldown(e.target.checked)} /> সম্প্রতি পাওয়া পরিবার বাদ দিন</label>
          <label className="check"><input type="checkbox" checked={allowPartial} onChange={(e) => setAllowPartial(e.target.checked)} /> ঘাটতি হলে সবাইকে কম কম দিন</label>
        </div>

        <div role="alert" aria-live="assertive">{error && <div className="alert alert-error">{error}</div>}</div>
        <div><button type="submit" disabled={busy || !effectiveStockId}>{busy ? 'হিসাব হচ্ছে…' : 'পরিকল্পনা করুন'}</button></div>
      </form>

      {r && plan && (
        <section className="stack" aria-label="পরিকল্পনার ফলাফল" aria-live="polite">
          <div className="grid">
            <div className="card"><div className="hint">বিতরণযোগ্য পরিবার</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{bnNum(r.summary.eligible)} / {bnNum(r.summary.households)}</div><div className="hint">সম্প্রতি পাওয়ায় বাদ: {bnNum(r.summary.excludedCooldown)}</div></div>
            <div className="card"><div className="hint">চাহিদা বনাম স্টক</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{bnNum(r.summary.totalNeed)} / {bnNum(r.summary.stock)} {plan.unit}</div><div className="hint">বরাদ্দ: {bnNum(r.summary.allocated)} · বাকি থাকবে: {bnNum(r.summary.leftover)}</div></div>
            <div className="card"><div className="hint">যারা পাবে</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{bnNum(r.summary.covered)}টি পরিবার</div><div className="hint">পূর্ণ পরিমাণ: {bnNum(r.summary.fullyCovered)}টি</div></div>
          </div>

          {!r.feasible && <div className="alert alert-error"><strong>সব শর্ত একসাথে পূরণ সম্ভব নয়।</strong> নিচে সবচেয়ে ভালো সম্ভাব্য পরিকল্পনা দেখানো হলো।</div>}
          {r.conflicts.map((c) => (
            <div key={c.code} className={`alert ${c.severity === 'blocking' ? 'alert-error' : 'alert-warn'}`}>{c.message}</div>
          ))}

          {r.lines.length > 0 && (
            <div className="card stack">
              <h2 style={{ marginTop: 0 }}>বরাদ্দের তালিকা (অগ্রাধিকার অনুযায়ী)</h2>
              <div className="table-wrap">
                <table>
                  <thead><tr><th scope="col">#</th><th scope="col">পরিবার</th><th scope="col">স্কোর ও কারণ</th><th scope="col">চাহিদা</th><th scope="col">বরাদ্দ</th></tr></thead>
                  <tbody>
                    {r.lines.map((l, i) => (
                      <tr key={l.householdId}>
                        <td>{bnNum(i + 1)}</td>
                        <td><a href={`/households/${l.householdId}`}>{l.headName}</a><div className="hint">{l.areaName}</div>{l.mustIncluded && <span className="badge badge-warn" title={l.mustReasons.join(', ')}>অবশ্যই: {l.mustReasons.join(', ')}</span>}</td>
                        <td><strong>{bnNum(l.score)}</strong><div className="hint">{l.reasons.slice(0, 3).map((x) => `${x.label} (+${bnNum(x.points)})`).join(' · ')}</div></td>
                        <td>{bnNum(l.need)}</td>
                        <td>{bnNum(l.qty)}{l.qty < l.need && <div className="hint">আংশিক</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {r.uncovered.length > 0 && (
            <details className="card">
              <summary><strong>যারা এবার পাবে না: {bnNum(r.uncovered.length)}টি পরিবার</strong></summary>
              <ul>
                {r.uncovered.slice(0, 100).map((u) => (
                  <li key={u.householdId}>
                    {u.headName} <span className="hint">({u.areaName}, স্কোর {bnNum(u.score)})</span> — <span className="badge">{UNCOVERED_BN[u.reason]}</span>
                    {u.mustIncluded && <span className="badge badge-danger"> অবশ্যই-অন্তর্ভুক্ত ছিল</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {r.lines.length > 0 && (
            <div className="card stack">
              <h2 style={{ marginTop: 0 }}>এই পরিকল্পনা অনুযায়ী বরাদ্দ দিন</h2>
              <div>
                <label htmlFor="p-vol">স্বেচ্ছাসেবী (এই ইউনিয়নের)</label>
                <select id="p-vol" value={volunteerId} onChange={(e) => setVolunteerId(e.target.value)}>
                  <option value="">{eligibleVols.length ? 'নির্বাচন করুন' : 'এই ইউনিয়নে আপনার কোনো স্বেচ্ছাসেবী নেই'}</option>
                  {eligibleVols.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </div>
              <div aria-live="polite">{applied && <div className="alert alert-ok">{applied}</div>}</div>
              <div><button type="button" onClick={apply} disabled={busy || !volunteerId || !!applied}>মোট {bnNum(r.summary.allocated)} {plan.unit} বরাদ্দ দিন</button></div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
