import type { Metadata } from 'next';
import './globals.css';
import TopNav from '@/components/TopNav';
import AppointmentReminder from '@/components/AppointmentReminder';

export const metadata: Metadata = {
  title: 'FEX CRM — Lead to Lifetime Value',
  description: 'Insurance sales + financial tracking CRM'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TopNav />
        <main className="mx-auto max-w-[1400px] px-4 py-5 md:px-6">{children}</main>
        <AppointmentReminder />
      </body>
    </html>
  );
}
