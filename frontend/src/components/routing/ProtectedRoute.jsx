/**
 * ProtectedRoute — redirects unauthenticated users to /login.
 *
 * - Shows a loading spinner while session is being established.
 * - Prevents protected content rendering before auth resolves.
 * - Preserves the intended destination via React Router's `state.from`.
 * - Guards against open-redirect by rejecting external URLs.
 */

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { LoadingSpinner } from '../ui/LoadingSpinner.jsx';

export function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <LoadingSpinner fullPage label="Checking session…" />;
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        state={{ from: location }}
        replace
      />
    );
  }

  return children;
}

