import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();

  useEffect(() => {
    const applyTheme = () => {
      document.body.classList.toggle('theme-light', localStorage.getItem('theme') === 'light');
    };
    applyTheme();
    window.addEventListener('storage', applyTheme);
    return () => window.removeEventListener('storage', applyTheme);
  }, []);

  useEffect(() => {
    // React Router does not reset browser scroll automatically in this SPA.
    // After the premium redesign, some pages are taller than the viewport; without this,
    // navigation from the sidebar can leave the user halfway down the next page.
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      document.querySelector('main')?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);

  return (
    <div className="app-shell min-h-screen overflow-x-hidden">
      <Sidebar />
      <main className="min-h-[100dvh] overflow-x-hidden pb-24 md:ml-64 md:pb-0">
        <div className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-5 sm:py-6">
          {children}
        </div>
      </main>
      <MobileNav />
    </div>
  );
}
