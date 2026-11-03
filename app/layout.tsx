import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { FetchBasePathPatch } from "@/components/FetchBasePathPatch";
import { CommentMode } from "@/components/CommentMode";

// Load Inter once at the root so EVERY tab uses the same typeface (previously only
// Overview / Calendar / My Day loaded it, leaving the rest on the system font).
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  title: "GooCampus Marketing OS",
  description: "Internal marketing operations & analytics for GooCampus — across Instagram, Facebook, LinkedIn, YouTube, Ads, SEO and web.",
  // The installed app's name on Mac / iPhone (app/manifest.ts is the rest).
  appleWebApp: { capable: true, title: "Marketing OS", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#FFFFFF" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script below sets data-theme before React loads.
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <head>
        {/* Paint the saved theme (components/Theme.tsx) before first render — no white flash. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('gc.theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();` }} />
      </head>
      <body className="min-h-screen antialiased">
        <FetchBasePathPatch />
        {children}
        <CommentMode />
      </body>
    </html>
  );
}
