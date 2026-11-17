'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="auth-screen">
      <div className="auth-card">
        <div className="brand-word">
          AVX<span>OS</span>
        </div>
        <h1>Something interrupted your workspace.</h1>
        <p>Your saved records remain in the database. Try loading this page again.</p>
        <button className="button primary" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
