import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ferrisofficial.github.io/ostrze-polnocy/"),
  title: "Bitwa pod Mostem — pojedynek 2D",
  description:
    "Dynamiczna gra przeglądarkowa o dwóch bezdomnych walczących siekierkami pod miejskim wiaduktem.",
  openGraph: {
    title: "Bitwa pod Mostem — pojedynek 2D",
    description:
      "Mirek kontra Staszek: zagraj lokalnie albo zmierz się ze znajomym online.",
    url: "https://ferrisofficial.github.io/ostrze-polnocy/",
    siteName: "Bitwa pod Mostem",
    locale: "pl_PL",
    type: "website",
    images: [
      {
        url: "https://ferrisofficial.github.io/ostrze-polnocy/og.png",
        width: 1672,
        height: 941,
        alt: "Mirek i Staszek walczą siekierkami pod miejskim wiaduktem.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Bitwa pod Mostem — pojedynek 2D",
    description: "Dwóch zawodników, jeden wiadukt i prawdziwy tryb online.",
    images: ["https://ferrisofficial.github.io/ostrze-polnocy/og.png"],
  },
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
