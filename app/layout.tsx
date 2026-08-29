import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import TopNav from '@/components/TopNav';
import AppointmentReminder from '@/components/AppointmentReminder';
import GoalsManager from '@/components/GoalsManager';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'FEX CRM — Lead to Lifetime Value',
  description: 'Insurance sales + financial tracking CRM'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <TopNav />
        <main className="mx-auto max-w-[1400px] px-4 py-5 md:px-6">{children}</main>
        <AppointmentReminder />
        <GoalsManager />
      </body>
    </html>
  );
}
