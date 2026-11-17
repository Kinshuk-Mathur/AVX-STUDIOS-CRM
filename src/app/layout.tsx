import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'AVX OS — Private Studio Workspace',
  description: 'The private operating system for AVX Studios.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
