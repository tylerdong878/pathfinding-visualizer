import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "How Game Characters Find You in 16.7 Milliseconds",
  description:
    "Draw walls on a grid, then watch A* search and Breadth-First Search hunt for the shortest route and compare how much of the map each one had to check.",
  openGraph: {
    title: "How Game Characters Find You in 16.7 Milliseconds",
    description:
      "Draw walls and watch two pathfinding algorithms search for the shortest route in real time.",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
