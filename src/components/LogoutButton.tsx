'use client';

export function LogoutButton() {
  return (
    <button
      type="button"
      className="btn-link"
      onClick={async () => {
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        window.location.href = '/login';
      }}
    >
      লগআউট
    </button>
  );
}
