import { useState } from 'react';
import { api, ApiError } from '../api/client';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex h-screen items-center justify-center p-6">
      <form
        className="card w-full max-w-sm p-8"
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
        <div className="mb-6">
          <img src="/logo-odile.png" alt="Odile AI" className="h-14 w-auto" />
          <div className="mt-1 text-xs text-muted">Connexion au studio de publication</div>
        </div>
        <label className="label">Mot de passe</label>
        <input
          type="password"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <button className="btn-primary mt-4 w-full justify-center" disabled={busy || !password}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}
