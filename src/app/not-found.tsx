import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card stack" style={{ maxWidth: 520, margin: '2rem auto' }}>
      <h1>পাতাটি পাওয়া যায়নি</h1>
      <p>এই ঠিকানায় কিছু নেই, অথবা এটি দেখার অনুমতি আপনার নেই।</p>
      <p><Link href="/" className="btn">মূল পাতায় যান</Link></p>
    </div>
  );
}
