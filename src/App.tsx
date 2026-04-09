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
  const [isRecording, setIsRecording] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);

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

  useEffect(() => {
    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      recorderRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
    };
  }, []);

  const canUseFileSystemAccess = useMemo(
    () => typeof window !== "undefined" && "showOpenFilePicker" in window,
    []
  );

  const startVisualiser = (stream: MediaStream) => {
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    audioContextRef.current = audioContext;

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const context = canvas.getContext("2d");
      if (!context) return;

      analyser.getByteTimeDomainData(dataArray);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.lineWidth = 2;
      context.strokeStyle = "#334155";
      context.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;

      for (let index = 0; index < bufferLength; index += 1) {
        const amplitude = dataArray[index] / 128;
        const y = (amplitude * canvas.height) / 2;

        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
        x += sliceWidth;
      }

      context.lineTo(canvas.width, canvas.height / 2);
      context.stroke();

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();
  };

  const stopVisualiser = () => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const startRecording = async () => {
    if (isRecording) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeType = ["audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus"].find((type) =>
        MediaRecorder.isTypeSupported(type)
      );

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = () => {
        const cleanMime = (recorder.mimeType || "audio/webm").split(";")[0].trim().toLowerCase();
        const extension = cleanMime.includes("mp4") ? "m4a" : cleanMime.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(chunks, { type: cleanMime || "audio/webm" });
        const file = new File([blob], `voice-note-${Date.now()}.${extension}`, {
          type: blob.type
        });

        setSelectedFile(file);
        setStatus("Recording ready. Translate to Malayalam.");
        setIsRecording(false);
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        stopVisualiser();
      };

      recorderRef.current = recorder;
      recorder.start(200);
      startVisualiser(stream);
      setIsRecording(true);
      setStatus("Recording...");
    } catch (error) {
      console.error(error);
      setStatus("Microphone permission denied or unavailable.");
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
  };

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
    <main className="mx-auto min-h-screen w-full max-w-5xl bg-slate-50 px-4 py-8 md:px-6">
      <Card>
        <CardHeader>
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">AI Audio Translator</p>
          <CardTitle>English Audio to Malayalam Text</CardTitle>
          <CardDescription>{status}</CardDescription>
        </CardHeader>

        <CardContent className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Audio Input</CardTitle>
              <CardDescription>
                Share from WhatsApp, pick an audio file, or record a short English note.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <canvas ref={canvasRef} width={460} height={100} className="mb-4 h-24 w-full rounded-md bg-slate-100" />

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={isRecording ? stopRecording : startRecording} disabled={isBusy}>
                  {isRecording ? "Stop Recording" : "Start Recording"}
                </Button>
                <Button type="button" variant="outline" onClick={pickAudioFile} disabled={isBusy}>
                  Pick Audio
                </Button>
                <Button type="button" onClick={submitAudio} disabled={!selectedFile || isBusy}>
                  Translate
                </Button>
              </div>

              {selectedFile && (
                <p className="mt-3 text-sm text-slate-600">
                  Selected file: <span className="font-medium text-slate-900">{selectedFile.name}</span>
                </p>
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
      </Card>
    </main>
  );
}

export default App;
