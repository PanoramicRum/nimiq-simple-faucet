import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nimiq Faucet — Next.js Example',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
