import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Sidebar from '@/components/Sidebar';
import AppointmentReminder from '@/components/AppointmentReminder';
import IncomingCallPopup from '@/components/IncomingCallPopup';
import GoalsManager from '@/components/GoalsManager';
import { getCurrentUser } from '@/lib/currentUser';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Solace — Lead to Lifetime Value',
  description: 'Insurance sales + financial tracking CRM'
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <div className={user ? 'flex min-h-screen' : ''}>
          <Sidebar user={user} />
          <main className={user ? 'min-w-0 flex-1 px-4 py-5 md:px-6' : 'mx-auto max-w-[1400px] px-4 py-5 md:px-6'}>{children}</main>
        </div>
        {user && <AppointmentReminder />}
        {user && <IncomingCallPopup />}
        {user && <GoalsManager />}
      </body>
    </html>
  );
}
