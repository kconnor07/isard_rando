import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Newspaper,
  Settings as SettingsIcon,
  Wrench,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api/client';

const NAV = [
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard },
  { to: '/approvals', label: 'À valider', icon: CheckCircle2 },
  { to: '/calendar', label: 'Calendrier', icon: CalendarDays },
  { to: '/news', label: 'Veille IA', icon: Newspaper },
  { to: '/comments', label: 'Commentaires & DM', icon: MessageCircle },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Réglages', icon: SettingsIcon },
  { to: '/setup', label: 'Connexions & santé', icon: Wrench },
];

export default function Layout() {
  const { data: summary } = useQuery({
    queryKey: ['summary'],
    queryFn: () =>
      api.get<{ awaitingApproval: number; pendingComments: number }>('/api/dashboard/summary'),
    refetchInterval: 30_000,
  });

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 w-60 border-r border-line bg-panel px-4 py-6 flex flex-col">
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent font-black text-white">
            O
          </div>
          <div>
            <div className="font-extrabold leading-tight">Odile Engine</div>
            <div className="text-[11px] text-muted">studio de publication</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-panel2 hover:text-txt'
                }`
              }
            >
              <Icon size={17} />
              <span className="flex-1">{label}</span>
              {to === '/approvals' && (summary?.awaitingApproval ?? 0) > 0 && (
                <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-white">
                  {summary!.awaitingApproval}
                </span>
              )}
              {to === '/comments' && (summary?.pendingComments ?? 0) > 0 && (
                <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-black">
                  {summary!.pendingComments}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <button
          className="btn-ghost mt-auto justify-center"
          onClick={async () => {
            await api.post('/api/auth/logout');
            location.href = '/login';
          }}
        >
          <LogOut size={15} /> Déconnexion
        </button>
      </aside>
      <main className="ml-60 flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
}
