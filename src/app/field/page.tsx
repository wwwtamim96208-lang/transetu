import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { FieldApp } from '@/components/field/FieldApp';

export const dynamic = 'force-dynamic';

export default async function FieldPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/field');
  if (user.role !== 'VOLUNTEER') {
    return (
      <div className="card stack">
        <h1>মাঠের মোড</h1>
        <p>এই পাতা মাঠকর্মী স্বেচ্ছাসেবীদের জন্য। বিতরণের হিসাব দেখতে <a href="/distributions">বিতরণ লেজার</a> খুলুন।</p>
      </div>
    );
  }
  return (
    <div className="stack">
      <h1>মাঠের কাজ</h1>
      <FieldApp userId={user.id} userName={user.name} />
    </div>
  );
}
