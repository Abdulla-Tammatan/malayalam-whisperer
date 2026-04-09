import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";

type TranslationMessage = {
  id: string;
  original: string;
  translated: string;
  sourceLanguage: string;
  targetLanguage: string;
  createdAt: string;
};

type ProxyResponse = {
  original: string;
  translated: string;
  detected_language: string;
  target_language: string;
};

const SUPABASE_FUNCTION_URL =
  import.meta.env.VITE_SUPABASE_FUNCTION_URL?.trim() || "/functions/v1/sarvam-proxy";

function compactMessage(input: string, max = 180): string {
  return input.length > max ? `${input.slice(0, max)}...` : input;
}

function parseError(raw: string): string {
  const text = raw.trim();
  if (!text) return "Unknown error";

  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return compactMessage(parsed.error || parsed.message || text);
  } catch {
    return compactMessage(text);
  }
}

function App() {
  const [messages, setMessages] = useState<TranslationMessage[]>([]);
  const [status, setStatus] = useState<string>("Ready");
  const [isBusy, setIsBusy] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const loadSharedAudio = async () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("share-target") !== "1") return;

      try {
        const response = await fetch("/shared-audio", { method: "GET" });
        if (!response.ok) return;

        const blob = await response.blob();
        const sharedFile = new File([blob], `whatsapp-${Date.now()}.ogg`, {
          type: blob.type || "audio/ogg"
        });
        setSelectedFile(sharedFile);
        setStatus("WhatsApp audio received. Ready to translate to Malayalam.");
      } catch (error) {
        console.error(error);
      } finally {
        await fetch("/shared-audio", { method: "DELETE" }).catch(() => undefined);

        params.delete("share-target");
        const next = params.toString();
        const cleanUrl = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`;
        window.history.replaceState({}, "", cleanUrl);
      }
    };

    void loadSharedAudio();
  }, []);

  const canUseFileSystemAccess = useMemo(
    () => typeof window !== "undefined" && "showOpenFilePicker" in window,
    []
  );

  const pickAudioFile = async () => {
    if (canUseFileSystemAccess) {
      try {
        const handles = await window.showOpenFilePicker?.({
          multiple: false,
          types: [
            {
              description: "Audio Files",
              accept: {
                "audio/*": [".ogg", ".mp3", ".wav", ".m4a", ".webm", ".aac", ".flac", ".opus", ".oga"]
              }
            }
          ]
        });

        if (!handles || handles.length === 0) return;
        const file = await handles[0].getFile();
        setSelectedFile(file);
        setStatus(`${file.name} selected.`);
        return;
      } catch (error) {
        if ((error as DOMException).name !== "AbortError") {
          console.error(error);
          setStatus("Could not read selected file.");
        }
      }
    }

    fileInputRef.current?.click();
  };

  const onFallbackFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setStatus(`${file.name} selected.`);
  };

  const submitAudio = async () => {
    if (!selectedFile || isBusy) return;

    setIsBusy(true);
    setStatus("Transcribing with Whisper and translating to Malayalam...");

    try {
      const formData = new FormData();
      formData.set("audio", selectedFile);

      const response = await fetch(SUPABASE_FUNCTION_URL, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${parseError(await response.text())}`);
      }

      const payload = (await response.json()) as ProxyResponse;
      const message: TranslationMessage = {
        id: crypto.randomUUID(),
        original: payload.original,
        translated: payload.translated,
        sourceLanguage: payload.detected_language,
        targetLanguage: payload.target_language,
        createdAt: new Date().toISOString()
      };
      setMessages((prev) => [message, ...prev]);
      setSelectedFile(null);
      setStatus("Translation complete.");
    } catch (error) {
      console.error(error);
      const msg = error instanceof Error ? compactMessage(error.message) : "Unexpected error";
      setStatus(`Audio translation failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl bg-white px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="overflow-hidden bg-white">
        <CardHeader className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">AI Audio Translator</p>
          <CardTitle className="text-2xl sm:text-3xl">English Audio to Malayalam Text</CardTitle>
          <CardDescription className="text-sm sm:text-base">{status}</CardDescription>
        </CardHeader>

        <CardContent className="grid gap-4 lg:grid-cols-2 lg:gap-6">
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Audio Input</CardTitle>
              <CardDescription>
                Share from WhatsApp or choose an English audio file, then translate to Malayalam.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button type="button" variant="outline" onClick={pickAudioFile} disabled={isBusy} className="w-full sm:w-auto">
                  Pick Audio
                </Button>
                <Button type="button" onClick={submitAudio} disabled={!selectedFile || isBusy} className="w-full sm:w-auto">
                  Translate
                </Button>
              </div>

              {selectedFile ? (
                <p className="mt-3 break-all text-sm text-slate-600">
                  Selected file: <span className="font-medium text-slate-900">{selectedFile.name}</span>
                </p>
              ) : (
                <p className="mt-3 text-sm text-slate-500">No file selected.</p>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.ogg,.mp3,.wav,.m4a,.webm,.aac,.flac,.opus,.oga"
                className="hidden"
                onChange={onFallbackFileChange}
              />
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Translations</CardTitle>
              <CardDescription>Most recent first.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {messages.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 p-3 text-sm text-slate-600">
                  No translations yet.
                </p>
              ) : (
                messages.map((item) => (
                  <article key={item.id} className="rounded-md border border-slate-200 bg-white p-3">
                    <p className="text-xs text-slate-500">{new Date(item.createdAt).toLocaleTimeString()}</p>
                    <p className="mt-2 text-sm text-slate-800">{item.original}</p>
                    <p className="mt-2 rounded-md bg-slate-100 p-2 text-sm font-medium text-slate-900">{item.translated}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      {item.sourceLanguage} to {item.targetLanguage}
                    </p>
                  </article>
                ))
              )}
            </CardContent>
          </Card>
        </CardContent>
      </div>
    </main>
  );
}

export default App;
