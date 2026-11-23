import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listAreas } from '@/lib/households';
import { HouseholdForm } from '@/components/HouseholdForm';

export default async function NewHouseholdPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/households/new');
  const areas = await listAreas();
  return (
    <div className="stack">
      <h1>নতুন পরিবার নিবন্ধন</h1>
      <HouseholdForm areas={areas} restrictToUnionId={user.role === 'VOLUNTEER' ? user.areaId : null} />
    </div>
  );
}
