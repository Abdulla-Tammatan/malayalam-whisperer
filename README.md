# AI Audio Translator PWA

A high-performance Progressive Web App built with Vite + React + Tailwind CSS.

## Features

- PWA manifest + Workbox service worker.
- `share_target` support for `audio/*` so the app can appear in Android/iOS share flows.
- Audio ingestion from:
  - `MediaRecorder` voice notes
  - File picker with File System Access API support
  - PWA share sheet (`.ogg` from WhatsApp supported)
- Live waveform visualisation using Web Audio API.
- Chat-style translation timeline (original + translated text).
- Language routing logic:
  - detected English -> Hindi (`hi-IN`)
  - detected non-English -> English (`en-IN`)
- Supabase Edge Function proxy to keep Sarvam API key off the frontend.

## Tech Stack

- Vite + React + TypeScript
- Tailwind CSS
- Workbox (via `vite-plugin-pwa` with `injectManifest`)
- Supabase Edge Functions (Deno)
- Sarvam.ai SDK (attempted first) + REST fallback for endpoint compatibility

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Configure frontend env:

```bash
cp .env.example .env
```

3. Start app:

```bash
npm run dev
```

## Supabase Edge Function Setup

1. Install/login to Supabase CLI and link your project.
2. Set secrets:

```bash
supabase secrets set SARVAM_API_KEY=YOUR_SARVAM_API_KEY
supabase secrets set SARVAM_API_BASE_URL=https://api.sarvam.ai
```

3. Deploy function:

```bash
supabase functions deploy sarvam-proxy
```

4. Put deployed function URL in `.env` as `VITE_SUPABASE_FUNCTION_URL`.

## Sarvam API Flow

- Audio:
  - `/speech-to-text` with `model: saaras:v3`, `language_code: unknown`
  - translate transcript with `/translate`
- Text:
  - detect language using `/text-lid`
  - translate using `/translate`

## iOS Optimization

- Includes Apple meta tags (`apple-mobile-web-app-capable`, status bar style, title).
- Includes an in-app Safari install prompt for Add to Home Screen.

## Build

```bash
npm run build
```
