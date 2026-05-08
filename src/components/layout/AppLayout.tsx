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
    <div className="app-shell">
      <Sidebar />
      <main className="md:ml-64 min-h-screen pb-20 md:pb-0">
        <div className="mx-auto max-w-7xl px-3 py-4 sm:px-5 sm:py-6">
          {children}
        </div>
      </main>
      <MobileNav />
    </div>
  );
}
