import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      includeAssets: ["icons/*", "favicon.svg"],
      manifest: {
        name: "AI Audio Translator",
        short_name: "Translator",
        description: "Translate shared and recorded audio with AI.",
        theme_color: "#0f172a",
        background_color: "#020617",
        display: "standalone",
        start_url: "/",
        scope: "/",
        orientation: "portrait",
        categories: ["productivity", "utilities"],
        icons: [
          {
            src: "/icons/icon.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ],
        share_target: {
          action: "/share-target",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            files: [
              {
                name: "audio",
                accept: ["audio/*"]
              }
            ]
          }
        }
      },
      injectManifest: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      }
    })
  ]
});
