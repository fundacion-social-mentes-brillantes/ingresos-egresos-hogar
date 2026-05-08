import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const applyTheme = () => {
      document.body.classList.toggle('theme-light', localStorage.getItem('theme') === 'light');
    };
    applyTheme();
    window.addEventListener('storage', applyTheme);
    return () => window.removeEventListener('storage', applyTheme);
  }, []);

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useLayoutEffect(() => {
    const resetScroll = () => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      mainRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    };

    resetScroll();
    const frame = window.requestAnimationFrame(resetScroll);
    const timeout = window.setTimeout(resetScroll, 80);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [location.pathname]);

  return (
    <div className="app-shell h-[100dvh] overflow-hidden">
      <Sidebar />
      <main
        ref={mainRef}
        className="fixed inset-0 overflow-y-auto overflow-x-hidden pb-24 md:left-64 md:pb-0"
      >
        <div key={location.pathname} className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-5 sm:py-6">
          {children}
        </div>
      </main>
      <MobileNav />
    </div>
  );
}
