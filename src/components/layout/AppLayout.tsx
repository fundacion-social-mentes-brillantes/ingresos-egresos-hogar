import { Sidebar, BottomNav } from './Sidebar';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-surface-900">
      <Sidebar />
      <main className="md:ml-64 min-h-screen pb-20 md:pb-0">
        <div className="max-w-5xl mx-auto px-4 py-6">
          {children}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
