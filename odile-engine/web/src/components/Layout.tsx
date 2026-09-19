import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Images as ImagesIcon,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Newspaper,
  Palette,
  Settings as SettingsIcon,
  Wrench,
  PenSquare,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api/client';

const NAV_GROUPS: {
  label: string;
  items: { to: string; label: string; icon: typeof LayoutDashboard }[];
}[] = [
  {
    label: 'Production',
    items: [
      { to: '/', label: 'Tableau de bord', icon: LayoutDashboard },
      { to: '/approvals', label: 'À valider', icon: CheckCircle2 },
      { to: '/calendar', label: 'Calendrier', icon: CalendarDays },
    ],
  },
  {
    label: 'Matière',
    items: [
      { to: '/news', label: 'Veille IA', icon: Newspaper },
      { to: '/templates', label: 'Templates', icon: Palette },
      { to: '/images', label: 'Images', icon: ImagesIcon },
      { to: '/comments', label: 'Commentaires & DM', icon: MessageCircle },
      { to: '/blog', label: 'Blog du site', icon: PenSquare },
    ],
  },
  {
    label: 'Pilotage',
    items: [
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
      { to: '/settings', label: 'Réglages', icon: SettingsIcon },
      { to: '/setup', label: 'Connexions & santé', icon: Wrench },
    ],
  },
];

/** Les pages qu'on ouvre tous les jours : les seules en pilules sur téléphone. */
const MOBILE_PRINCIPALES = ['/', '/approvals', '/calendar', '/comments'];

function CountBadge({ value, tone }: { value: number; tone: 'solid' | 'outline' }) {
  if (value <= 0) return null;
  return (
    <span
      className={`mono rounded-full px-2 py-0.5 text-[10px] ${
        tone === 'solid'
          ? 'bg-accent text-white'
          : 'border border-line text-txt'
      }`}
    >
      {value}
    </span>
  );
}

export default function Layout() {
  const { data: summary } = useQuery({
    queryKey: ['summary'],
    queryFn: () =>
      api.get<{ awaitingApproval: number; pendingComments: number }>('/api/dashboard/summary'),
    refetchInterval: 30_000,
  });

  const navItem = ({ isActive }: { isActive: boolean }) =>
    `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
      isActive ? 'bg-accent-soft text-ice' : 'text-muted hover:bg-white/[0.04] hover:text-txt'
    }`;

  const renderLinks = () =>
    NAV_GROUPS.map((group) => (
      <div key={group.label} className="mb-5">
        <div className="mono mb-1.5 px-3 text-[10px] uppercase tracking-[0.18em] text-muted/60">
          {group.label}
        </div>
        <nav className="flex flex-col gap-0.5">
          {group.items.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={navItem}>
              {({ isActive }) => (
                <>
                  <span
                    className={`absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent transition-opacity ${
                      isActive ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                  <Icon size={16} strokeWidth={2} />
                  <span className="flex-1">{label}</span>
                  {to === '/approvals' && (
                    <CountBadge value={summary?.awaitingApproval ?? 0} tone="solid" />
                  )}
                  {to === '/comments' && (
                    <CountBadge value={summary?.pendingComments ?? 0} tone="outline" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    ));

  return (
    <div className="min-h-[100dvh]">
      <div className="grain-layer" />

      {/* Rail de navigation (desktop) */}
      <aside className="fixed inset-y-0 hidden w-60 flex-col border-r border-line bg-panel/70 px-3 py-6 backdrop-blur-sm md:flex">
        <div className="mb-7 px-3">
          <img src="/logo-odile.png" alt="Odile AI" className="h-9 w-auto" />
          <div className="mono mt-2 text-[10px] uppercase tracking-[0.22em] text-muted/70">
            Régie de publication
          </div>
        </div>
        {renderLinks()}
        <button
          className="btn-ghost mt-auto justify-center"
          onClick={async () => {
            await api.post('/api/auth/logout');
            location.href = '/login';
          }}
        >
          <LogOut size={14} /> Déconnexion
        </button>
      </aside>

      {/* Barre mobile */}
      <header className="sticky top-0 z-40 border-b border-line bg-panel/85 backdrop-blur md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <img src="/logo-odile.png" alt="Odile AI" className="h-7 w-auto" />
          <button
            className="btn-ghost !px-2.5 !py-1.5"
            onClick={async () => {
              await api.post('/api/auth/logout');
              location.href = '/login';
            }}
          >
            <LogOut size={13} />
          </button>
        </div>
        {/* Sur téléphone : les quatre pages du quotidien en pilules (avec le compteur de posts
            à valider), le reste replié derrière « Plus » — onze pilules défilantes cachaient
            Réglages et Connexions hors écran. */}
        <nav className="flex flex-wrap gap-1 px-3 pb-2">
          {NAV_GROUPS.flatMap((g) => g.items)
            .filter(({ to }) => MOBILE_PRINCIPALES.includes(to))
            .map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? 'border-accent/45 bg-accent-soft text-ice'
                      : 'border-line text-muted hover:text-txt'
                  }`
                }
              >
                {label}
                {to === '/approvals' && <CountBadge value={summary?.awaitingApproval ?? 0} tone="solid" />}
                {to === '/comments' && <CountBadge value={summary?.pendingComments ?? 0} tone="outline" />}
              </NavLink>
            ))}
          <details className="relative">
            <summary className="cursor-pointer list-none whitespace-nowrap rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted hover:text-txt">
              Plus…
            </summary>
            <div className="absolute left-0 z-50 mt-1 flex w-56 flex-col gap-0.5 rounded-2xl border border-line bg-panel p-2 shadow-2xl">
              {NAV_GROUPS.flatMap((g) => g.items)
                .filter(({ to }) => !MOBILE_PRINCIPALES.includes(to))
                .map(({ to, label, icon: Icon }) => (
                  <NavLink key={to} to={to} className={({ isActive }) => `flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${isActive ? 'bg-accent-soft text-ice' : 'text-muted hover:text-txt'}`}>
                    <Icon size={15} /> {label}
                  </NavLink>
                ))}
            </div>
          </details>
        </nav>
      </header>

      <main className="md:ml-60">
        <div className="mx-auto max-w-[1100px] px-4 py-6 md:px-8 md:py-9">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
