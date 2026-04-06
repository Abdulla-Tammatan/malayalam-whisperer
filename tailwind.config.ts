import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#020617",
        night: "#0f172a",
        mist: "#cbd5e1",
        accent: "#22d3ee"
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(34,211,238,0.3), 0 10px 35px rgba(34,211,238,0.2)"
      },
      fontFamily: {
        sans: ["'Plus Jakarta Sans'", "ui-sans-serif", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"]
      }
    }
  },
  plugins: []
} satisfies Config;
