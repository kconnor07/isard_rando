import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ApiError, api, humanizeError } from './api/client';
import Layout from './components/Layout';
import Analytics from './pages/Analytics';
import Approvals from './pages/Approvals';
import Blog from './pages/Blog';
import Calendar from './pages/Calendar';
import Comments from './pages/Comments';
import Dashboard from './pages/Dashboard';
import Images from './pages/Images';
import Login from './pages/Login';
import News from './pages/News';
import PostEditor from './pages/PostEditor';
import Settings from './pages/Settings';
import Templates from './pages/Templates';
import Setup from './pages/Setup';

export default function App() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['auth'],
    queryFn: () => api.get<{ authenticated: boolean }>('/api/auth/me'),
    retry: false,
  });

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center text-muted">Chargement…</div>;
  }
  // Un moteur qui ne répond pas n'est pas une session expirée. Confondre les deux
  // envoyait la personne taper son mot de passe pendant qu'un déploiement tournait :
  // elle croyait s'être trompée, alors que rien ne pouvait marcher. Le 401, lui, EST
  // une session absente : il mène à l'écran de connexion, comme il se doit.
  if (isError && !(error instanceof ApiError && error.status === 401)) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md rounded-2xl border border-line bg-white/[0.02] p-8 text-center">
          <p className="text-sm font-semibold text-txt">Le moteur ne répond pas</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">{humanizeError(error)}</p>
          <p className="mt-2 text-xs text-muted">
            Ce n’est pas ta session : rien n’est perdu, et rien n’est publié sans le serveur. Si un déploiement est en cours, il finit en une
            minute.
          </p>
          <button className="btn-primary mt-5" onClick={() => void refetch()}>
            Réessayer
          </button>
        </div>
      </div>
    );
  }
  if (!data?.authenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/posts/:id" element={<PostEditor />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/news" element={<News />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/images" element={<Images />} />
        <Route path="/comments" element={<Comments />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
