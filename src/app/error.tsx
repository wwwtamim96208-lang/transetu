'use client';

// Shown when a page fails to render (e.g. database briefly unreachable). Nothing is lost:
// the user can retry, and field data on the phone stays in the offline outbox.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card stack" style={{ maxWidth: 520, margin: '2rem auto' }} role="alert">
      <h1>কিছু একটা সমস্যা হয়েছে</h1>
      <p>সার্ভারের সাথে যোগাযোগে সমস্যা হতে পারে। আপনার কোনো তথ্য হারায়নি। একটু পরে আবার চেষ্টা করুন।</p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => reset()}>আবার চেষ্টা করুন</button>
        <a href="/" className="btn btn-secondary">মূল পাতায় যান</a>
      </div>
    </div>
  );
}
