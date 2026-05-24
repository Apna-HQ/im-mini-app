"use client";

import '../src/styles.css';
import { ApnaProvider } from '../src/apna-provider';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ApnaProvider>{children}</ApnaProvider>
      </body>
    </html>
  );
}
