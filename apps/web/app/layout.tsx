import './globals.css';

export const metadata = {
  title: 'Event Ticketing Platform',
  description: 'Sell tickets, run check-in and track attendance for your events.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
