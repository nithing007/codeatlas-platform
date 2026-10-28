/**
 * Application root — router, auth provider, and app shell.
 *
 * Route structure:
 *   /                      — Public landing page
 *   /login                 — Email OTP + Google OAuth (redirects authenticated users away)
 *   /dashboard             — Protected
 *   /repositories          — Protected (Phase 6B)
 *   /repositories/:id      — Protected (Phase 6B)
 *   /repositories/:id/scans/:scanId — Protected (Phase 6C)
 *   *                      — 404
 */

import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { Navbar } from './components/layout/Navbar.jsx';
import { ProtectedRoute } from './components/routing/ProtectedRoute.jsx';
import { PublicOnlyRoute } from './components/routing/PublicOnlyRoute.jsx';

// Pages
import { LandingPage } from './pages/LandingPage.jsx';
import { LoginPage } from './pages/auth/LoginPage.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import {
  RepositoriesPage,
  RepositoryDetailPage,
  ScanDetailPage,
} from './pages/PlaceholderPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div id="app-shell">
          <Navbar />
          <Routes>
            {/* Public */}
            <Route path="/" element={<LandingPage />} />

            {/* Public-only: redirect authenticated users to /dashboard */}
            <Route
              path="/login"
              element={
                <PublicOnlyRoute>
                  <LoginPage />
                </PublicOnlyRoute>
              }
            />

            {/* Protected routes */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/repositories"
              element={
                <ProtectedRoute>
                  <RepositoriesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/repositories/:repositoryId"
              element={
                <ProtectedRoute>
                  <RepositoryDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/repositories/:repositoryId/scans/:scanId"
              element={
                <ProtectedRoute>
                  <ScanDetailPage />
                </ProtectedRoute>
              }
            />

            {/* 404 */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}
