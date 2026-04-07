import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SARVAM_API_BASE_URL = Deno.env.get("SARVAM_API_BASE_URL") ?? "https://api.sarvam.ai";
const SARVAM_API_KEY = Deno.env.get("SARVAM_API_KEY") ?? "";

type TranslationResult = {
  original: string;
  translated: string;
  detected_language: string;
  target_language: string;
};

class SarvamHttpError extends Error {
  status: number;
  payload: Record<string, unknown>;
  path: string;

  constructor(path: string, status: number, message: string, payload: Record<string, unknown>) {
    super(message);
    this.name = "SarvamHttpError";
    this.status = status;
    this.payload = payload;
    this.path = path;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

let cachedClient: Record<string, unknown> | null | undefined;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const pickString = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

function normalizeLanguageCode(input: string): string {
  const value = input.trim();
  return value.length > 0 ? value : "unknown";
}

function chooseTargetLanguage(languageCode: string): string {
  return languageCode.toLowerCase().startsWith("en") ? "hi-IN" : "en-IN";
}

async function parseJsonResponse(path: string, response: Response): Promise<Record<string, unknown>> {
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const message =
      pickString(payload.error) ||
      pickString(payload.message) ||
      pickString(payload.detail) ||
      "Unknown Sarvam error";

    throw new SarvamHttpError(
      path,
      response.status,
      `Sarvam API error (${response.status}): ${message}`,
      payload
    );
  }

  return payload;
}

async function sarvamFetch(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${SARVAM_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "api-subscription-key": SARVAM_API_KEY
    }
  });

  return parseJsonResponse(path, response);
}

async function getSarvamClient(): Promise<Record<string, unknown> | null> {
  if (cachedClient !== undefined) return cachedClient;

  try {
    const moduleExports = (await import("npm:sarvamai@latest")) as Record<string, unknown>;
    const ctorCandidate =
      moduleExports.SarvamAI ??
      asRecord(moduleExports.default).SarvamAI ??
      moduleExports.default;

    if (typeof ctorCandidate !== "function") {
      cachedClient = null;
      return null;
    }

    const SarvamCtor = ctorCandidate as new (init: unknown) => Record<string, unknown>;
    const constructorInputs: unknown[] = [
      { apiSubscriptionKey: SARVAM_API_KEY },
      { api_subscription_key: SARVAM_API_KEY },
      { apiKey: SARVAM_API_KEY },
      SARVAM_API_KEY
    ];

    for (const input of constructorInputs) {
      try {
        cachedClient = new SarvamCtor(input);
        return cachedClient;
      } catch {
        // Continue through known constructor variants.
      }
    }
  } catch {
    cachedClient = null;
    return null;
  }

  cachedClient = null;
  return null;
}

async function detectTextLanguage(text: string): Promise<string> {
  const client = await getSarvamClient();

  try {
    const textTools = asRecord(client?.text);
    const lidMethod = (textTools.lid ?? textTools.textLid ?? textTools.detectLanguage) as
      | ((payload: Record<string, unknown>) => Promise<unknown>)
      | undefined;

    if (lidMethod) {
      const result = asRecord(await lidMethod({ input: text, text }));
      return normalizeLanguageCode(
        pickString(result.language_code) ||
          pickString(result.language) ||
          pickString(result.detected_language)
      );
    }
  } catch {
    // Fall through to HTTP endpoint.
  }

  const payload = await sarvamFetch("/text-lid", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: text, text })
  });

  return normalizeLanguageCode(
    pickString(payload.language_code) || pickString(payload.language) || pickString(payload.detected_language)
  );
}

async function translateText(text: string, sourceLanguage: string, targetLanguage: string): Promise<string> {
  const client = await getSarvamClient();

  try {
    const translateTools = asRecord(client?.translate);
    const textTools = asRecord(client?.text);

    const translateMethod =
      (translateTools.translateText ?? translateTools.translate ?? textTools.translate) as
      | ((payload: Record<string, unknown>) => Promise<unknown>)
      | undefined;

    if (translateMethod) {
      const result = asRecord(
        await translateMethod({
          input: text,
          text,
          source_language_code: sourceLanguage,
          target_language_code: targetLanguage,
          source_language: sourceLanguage,
          target_language: targetLanguage,
          model: "sarvam-translate:v1"
        })
      );

      const candidate =
        pickString(result.translated_text) ||
        pickString(result.translation) ||
        pickString(result.output) ||
        pickString(asRecord(result.data).translated_text);

      if (candidate) return candidate;
    }
  } catch {
    // Fall through to HTTP endpoint.
  }

  const payload = await sarvamFetch("/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: text,
      text,
      source_language_code: sourceLanguage,
      target_language_code: targetLanguage,
      source_language: sourceLanguage,
      target_language: targetLanguage,
      model: "sarvam-translate:v1"
    })
  });

  return (
    pickString(payload.translated_text) ||
    pickString(payload.translation) ||
    pickString(payload.output) ||
    pickString(asRecord(payload.data).translated_text) ||
    ""
  );
}

async function transcribeAudio(file: File): Promise<{ transcript: string; languageCode: string }> {
  const client = await getSarvamClient();

  try {
    const speechTools = asRecord(client?.speechToText);
    const legacySpeechTools = asRecord(client?.speech_to_text);

    const transcribeMethod =
      (speechTools.transcribe ?? legacySpeechTools.transcribe) as
      | ((blob: File, options: Record<string, unknown>) => Promise<unknown>)
      | undefined;

    if (transcribeMethod) {
      const result = asRecord(
        await transcribeMethod(file, {
          model: "saaras:v3",
          mode: "transcribe",
          language_code: "unknown",
          languageCode: "unknown"
        })
      );

      const transcript =
        pickString(result.transcript) ||
        pickString(result.text) ||
        pickString(result.output);

      if (transcript) {
        return {
          transcript,
          languageCode: normalizeLanguageCode(pickString(result.language_code) || pickString(result.language))
        };
      }
    }
  } catch {
    // Fall through to HTTP endpoint.
  }

  const formData = new FormData();
  formData.set("file", file);
  formData.set("model", "saaras:v3");
  formData.set("mode", "transcribe");
  formData.set("language_code", "unknown");

  const payload = await sarvamFetch("/speech-to-text", {
    method: "POST",
    body: formData
  });

  return {
    transcript: pickString(payload.transcript) || pickString(payload.text),
    languageCode: normalizeLanguageCode(
      pickString(payload.language_code) || pickString(payload.language) || "unknown"
    )
  };
}

function jsonResponse(payload: TranslationResult, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    }
  });
}

function errorResponse(message: string, status = 500, details?: unknown): Response {
  const payload: Record<string, unknown> = { error: message };
  if (details !== undefined) {
    payload.details = details;
  }

  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    }
  });
}

serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!SARVAM_API_KEY) {
    return errorResponse("Missing SARVAM_API_KEY secret.", 500);
  }

  if (request.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const formData = await request.formData();
      const audio = formData.get("audio");
      if (!(audio instanceof File)) {
        return errorResponse("audio form-data file is required", 400);
      }

      const { transcript, languageCode } = await transcribeAudio(audio);
      const sourceLanguage = normalizeLanguageCode(languageCode);
      const targetLanguage = chooseTargetLanguage(sourceLanguage);
      const translated = await translateText(transcript, sourceLanguage, targetLanguage);

      return jsonResponse({
        original: transcript,
        translated,
        detected_language: sourceLanguage,
        target_language: targetLanguage
      });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const text = pickString(body.text).trim();

    if (!text) {
      return errorResponse("text is required", 400);
    }

    const sourceLanguage = await detectTextLanguage(text);
    const targetLanguage = chooseTargetLanguage(sourceLanguage);
    const translated = await translateText(text, sourceLanguage, targetLanguage);

    return jsonResponse({
      original: text,
      translated,
      detected_language: sourceLanguage,
      target_language: targetLanguage
    });
  } catch (error) {
    if (error instanceof SarvamHttpError) {
      return errorResponse(error.message, 500, {
        provider_status: error.status,
        provider_path: error.path,
        provider_payload: error.payload
      });
    }

    const message = error instanceof Error ? error.message : "Unexpected server error";
    return errorResponse(message, 500);
  }
});
