/**
 * PublicOnlyRoute — redirects already-authenticated users away from public-only
 * pages (e.g. /login) to the dashboard.
 */

import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { LoadingSpinner } from '../ui/LoadingSpinner.jsx';

export function PublicOnlyRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingSpinner fullPage label="Checking session…" />;
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

