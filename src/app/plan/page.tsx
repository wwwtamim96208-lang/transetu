import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { planContext } from '@/lib/planning';
import { PlanTool } from '@/components/PlanTool';
import { unitBn } from '@/lib/domain/format';

export default async function PlanPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/plan');
  if (user.role === 'VOLUNTEER') redirect('/field');
  const ctx = await planContext(user);
  const upazilaName = new Map(ctx.areas.filter((a) => a.level === 'UPAZILA').map((a) => [a.id, a.nameBn]));
  return (
    <div className="stack">
      <h1>বরাদ্দ পরিকল্পনা</h1>
      <p className="hint">স্টক সীমিত হলে কোন পরিবার আগে পাবে, আর কেন, সিস্টেম তা হিসাব করে দেখায়। বাধ্যতামূলক শর্ত পূরণ সম্ভব না হলে সেটাও স্পষ্ট জানায়।</p>
      <PlanTool
        categories={ctx.categories.map((c) => ({ id: c.id, label: c.nameBn, unit: unitBn(c.unit) }))}
        unions={ctx.areas.filter((a) => a.level === 'UNION').map((a) => ({ id: a.id, label: `${upazilaName.get(a.parentId ?? '') ?? ''} › ${a.nameBn}`, upazilaId: a.parentId ?? '' }))}
        stocks={ctx.stocks.map((s) => ({ id: s.id, categoryId: s.categoryId, areaId: s.areaId, quantity: s.quantity, orgName: s.org.nameBn }))}
        volunteers={ctx.volunteers.map((v) => ({ id: v.id, label: v.name, areaId: v.areaId, orgId: v.orgId }))}
      />
    </div>
  );
}
