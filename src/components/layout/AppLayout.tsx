import { useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  useEffect(() => {
    const applyTheme = () => {
      document.body.classList.toggle('theme-light', localStorage.getItem('theme') === 'light');
    };
    applyTheme();
    window.addEventListener('storage', applyTheme);
    return () => window.removeEventListener('storage', applyTheme);
  }, []);

  return (
    <div className="min-h-screen bg-surface-900">
      <Sidebar />
      <main className="md:ml-64 min-h-screen pb-20 md:pb-0">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
          {children}
        </div>
      </main>
      <MobileNav />
    </div>
  );
}
