import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api/client';
import Layout from './components/Layout';
import Analytics from './pages/Analytics';
import Approvals from './pages/Approvals';
import Calendar from './pages/Calendar';
import Comments from './pages/Comments';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import News from './pages/News';
import PostEditor from './pages/PostEditor';
import Settings from './pages/Settings';
import Setup from './pages/Setup';

export default function App() {
  const { data, isLoading } = useQuery({
    queryKey: ['auth'],
    queryFn: () => api.get<{ authenticated: boolean }>('/api/auth/me'),
    retry: false,
  });

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center text-muted">Chargement…</div>;
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
        <Route path="/comments" element={<Comments />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
