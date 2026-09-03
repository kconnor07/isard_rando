import { useState } from 'react';
import { api, ApiError } from '../api/client';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="grid min-h-[100dvh] md:grid-cols-[minmax(0,30rem)_1fr]">
      <div className="grain-layer" />

      {/* Colonne connexion */}
      <div className="flex flex-col justify-center px-8 py-12 md:px-14">
        <form
          className="rise w-full max-w-sm"
          style={{ '--i': 0 } as React.CSSProperties}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await api.post('/api/auth/login', { password });
              location.href = '/';
            } catch (err) {
              setError(err instanceof ApiError ? 'Mot de passe incorrect' : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <img src="/logo-odile.png" alt="Odile AI" className="h-11 w-auto" />
          <div className="mono mt-3 text-[10px] uppercase tracking-[0.22em] text-muted/70">
            Régie de publication
          </div>

          <div className="mt-10">
            <label className="label" htmlFor="password">
              Mot de passe
            </label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
            {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
            <button className="btn-primary mt-5 w-full justify-center" disabled={busy || !password}>
              {busy ? 'Connexion…' : 'Entrer dans la régie'}
            </button>
          </div>
        </form>
      </div>

      {/* Panneau d'ambiance — l'univers des slides, en écho */}
      <div className="relative hidden overflow-hidden border-l border-line md:block">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle closest-side at 68% 38%, rgba(0,90,205,0.5), rgba(4,10,26,0.05) 78%, transparent 100%),' +
              'radial-gradient(circle closest-side at 30% 78%, rgba(0,60,150,0.42), transparent 100%),' +
              'radial-gradient(80% 60% at 85% 110%, rgba(0,153,255,0.12), transparent 70%),' +
              '#05060c',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle closest-side at 68% 38%, transparent 96%, rgba(160,215,255,0.35) 99%, transparent 100%)',
          }}
        />
        <div className="absolute bottom-12 left-12 right-12">
          <p className="accent-serif text-[26px] leading-snug text-ice/90">
            La machine a veillé toute la nuit.
          </p>
          <p className="mt-1 text-sm text-muted">Il ne reste qu'à valider.</p>
        </div>
      </div>
    </div>
  );
}
