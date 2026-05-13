// src/components/layouts/PublicLayout.tsx
import React from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const TrendtialLogo = () => (
  <div className="flex items-center justify-center mb-8">
    <svg width="48" height="48" viewBox="0 0 200 200" className="mr-3">
      <defs>
        <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: 'rgb(220, 38, 38)', stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: 'rgb(239, 68, 68)', stopOpacity: 1 }} />
        </linearGradient>
      </defs>
      <rect width="200" height="200" rx="30" fill="url(#grad1)" />
      <text x="25" y="140" fontFamily="Arial, sans-serif" fontSize="100" fontWeight="bold" fill="white">tr.</text>
    </svg>
    <span className="text-4xl font-bold text-foreground">Trendtial</span>
  </div>
);

const ServiceDownBanner: React.FC = () => (
  <div className="w-full max-w-md mb-4 flex items-start gap-3 rounded-lg border border-yellow-400/50 bg-yellow-50 dark:bg-yellow-900/20 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
    <span className="mt-0.5 shrink-0 text-base">⚠️</span>
    <span>
      <strong>Authentication service unreachable.</strong> The Supabase project may be{' '}
      <strong>paused</strong> (free-tier projects pause after inactivity).{' '}
      <a
        href="https://app.supabase.com"
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:opacity-80"
      >
        Open Supabase dashboard
      </a>{' '}
      → restore your project, then try logging in again.
    </span>
  </div>
);

const PublicLayout: React.FC = () => {
  const { serviceReachable } = useAuth();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground p-4">
      <TrendtialLogo />
      {!serviceReachable && <ServiceDownBanner />}
      <main className="w-full max-w-md">
        <div className="bg-card shadow-2xl rounded-xl p-8 sm:p-10">
          <Outlet />
        </div>
      </main>
      <footer className="mt-8 text-center text-sm text-muted-foreground">
        &copy; {new Date().getFullYear()} Trendtial CRM. All rights reserved.
      </footer>
    </div>
  );
};

export default PublicLayout; 