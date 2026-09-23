export const metadata = {
  title: 'Event Ticketing Platform',
  description: 'Phase 1 foundation — customer, organizer, and admin surfaces land here in later phases.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
