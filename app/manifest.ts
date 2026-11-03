import type { MetadataRoute } from "next";

// Installable app (3 Nov 2026): Chrome and Edge offer "Install Marketing OS", and it
// then opens in its own window with the "M" icon — on Mac (Dock, Launchpad) and on
// Windows (Start menu, taskbar). It is the same live dashboard: every deploy shows up
// in the app straight away. public/sw.js only adds an offline page.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/dashboard/preview",
    name: "GooCampus Marketing OS",
    short_name: "Marketing OS",
    description: "GooCampus marketing operations — tasks, content, analytics and reports.",
    start_url: "/dashboard/preview",
    scope: "/",
    display: "standalone",
    background_color: "#F6F7FB",
    theme_color: "#FFFFFF",
    icons: [
      { src: "/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
