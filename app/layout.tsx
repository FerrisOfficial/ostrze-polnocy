import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ostrze Północy — pojedynek 2D",
  description:
    "Dynamiczna gra przeglądarkowa dla dwóch graczy walczących siekierami.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
