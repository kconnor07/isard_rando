import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Le dernier filet : une exception de rendu ne laisse plus un écran noir.
 *
 * Sans lui, une seule donnée inattendue (un champ absent, un JSON mal formé) vide
 * toute la page — sans un mot, sans un bouton, et sans que personne sache si le
 * moteur tourne encore. On dit ce qui s'est passé et on propose de recharger.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state: { err: Error | null } = { err: null };

  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('écran en erreur', err, info.componentStack);
  }

  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md rounded-2xl border border-line bg-white/[0.02] p-8 text-center">
          <p className="text-sm font-semibold text-txt">Cet écran s’est arrêté</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Rien n’est perdu : les posts, les réglages et la file de publication sont côté serveur. Recharge la page — si l’écran se bloque à
            nouveau, le détail est dans la console du navigateur.
          </p>
          <p className="mono mt-3 break-words text-xs text-muted">{this.state.err.message.slice(0, 200)}</p>
          <button className="btn-primary mt-5" onClick={() => location.reload()}>
            Recharger
          </button>
        </div>
      </div>
    );
  }
}
