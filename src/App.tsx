import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

type TranslationMessage = {
  id: string;
  kind: "audio" | "text";
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

const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const isSafari = /Safari/i.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/i.test(navigator.userAgent);

function App() {
  const [messages, setMessages] = useState<TranslationMessage[]>([]);
  const [textInput, setTextInput] = useState("");
  const [status, setStatus] = useState<string>("Ready");
  const [isBusy, setIsBusy] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    if (isIOS && isSafari && !standalone) {
      setShowInstallPrompt(true);
    }
  }, []);

  useEffect(() => {
    const loadSharedAudio = async () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("share-target") !== "1") return;

      try {
        const response = await fetch("/shared-audio", { method: "GET" });
        if (!response.ok) return;

        const blob = await response.blob();
        const sharedFile = new File([blob], `shared-${Date.now()}.ogg`, {
          type: blob.type || "audio/ogg"
        });
        setSelectedFile(sharedFile);
        setStatus("Audio received from share sheet.");
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
      stopVisualiser();
      cleanupRecorder();
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
      context.strokeStyle = "#22d3ee";
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

    const audioContext = audioContextRef.current;
    if (audioContext) {
      void audioContext.close();
      audioContextRef.current = null;
    }
  };

  const cleanupRecorder = () => {
    recorderRef.current = null;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    setIsRecording(false);
  };

  const startRecording = async () => {
    if (isRecording) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((type) =>
        MediaRecorder.isTypeSupported(type)
      );

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const extension = recorder.mimeType.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `voice-note-${Date.now()}.${extension}`, {
          type: blob.type
        });

        setSelectedFile(file);
        stopVisualiser();
        cleanupRecorder();
        setStatus("Voice note captured. Ready for translation.");
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
              accept: { "audio/*": [".ogg", ".mp3", ".wav", ".m4a", ".webm"] }
            }
          ]
        });

        if (!handles || handles.length === 0) return;
        const file = await handles[0].getFile();
        setSelectedFile(file);
        setStatus(`${file.name} ready.`);
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
    setStatus(`${file.name} ready.`);
  };

  const pushMessage = (kind: "audio" | "text", payload: ProxyResponse) => {
    const chatMessage: TranslationMessage = {
      id: crypto.randomUUID(),
      kind,
      original: payload.original,
      translated: payload.translated,
      sourceLanguage: payload.detected_language,
      targetLanguage: payload.target_language,
      createdAt: new Date().toISOString()
    };

    setMessages((prev) => [chatMessage, ...prev]);
  };

  const submitAudio = async () => {
    if (!selectedFile || isBusy) return;

    setIsBusy(true);
    setStatus("Transcribing audio with saaras:v3...");

    try {
      const formData = new FormData();
      formData.set("audio", selectedFile);

      const response = await fetch(SUPABASE_FUNCTION_URL, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = (await response.json()) as ProxyResponse;
      pushMessage("audio", payload);
      setSelectedFile(null);
      setStatus("Audio translated.");
    } catch (error) {
      console.error(error);
      setStatus("Audio translation failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const submitText = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!textInput.trim() || isBusy) return;

    setIsBusy(true);
    setStatus("Detecting text language and translating...");

    try {
      const response = await fetch(SUPABASE_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textInput.trim() })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = (await response.json()) as ProxyResponse;
      pushMessage("text", payload);
      setTextInput("");
      setStatus("Text translated.");
    } catch (error) {
      console.error(error);
      setStatus("Text translation failed.");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-6 md:px-8">
      <section className="rounded-3xl border border-cyan-200/20 bg-slate-900/50 p-6 shadow-glow backdrop-blur-md">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-cyan-200">AI Audio Translator</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-100">Share, Speak, Translate</h1>
          </div>
          <p className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100">
            {status}
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-100">Audio Input</h2>
            <canvas ref={canvasRef} width={460} height={100} className="mb-3 h-24 w-full rounded-lg bg-slate-900" />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                className="rounded-xl bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
                disabled={isBusy}
              >
                {isRecording ? "Stop Recording" : "Start Recording"}
              </button>

              <button
                type="button"
                onClick={pickAudioFile}
                className="rounded-xl border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-100"
                disabled={isBusy}
              >
                {canUseFileSystemAccess ? "Pick Audio (FSA)" : "Pick Audio"}
              </button>

              <button
                type="button"
                onClick={submitAudio}
                className="rounded-xl border border-cyan-400/60 px-3 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-60"
                disabled={!selectedFile || isBusy}
              >
                Translate Audio
              </button>
            </div>

            {selectedFile && (
              <p className="mt-3 text-xs text-slate-300">
                Selected: <span className="font-mono text-cyan-100">{selectedFile.name}</span>
              </p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={onFallbackFileChange}
            />
          </div>

          <form onSubmit={submitText} className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-100">Text Input</h2>
            <label htmlFor="textInput" className="mb-2 block text-xs text-slate-400">
              Auto-detected via "text-lid" then translated (English to Hindi and Hindi to English)
            </label>
            <textarea
              id="textInput"
              rows={4}
              value={textInput}
              onChange={(event) => setTextInput(event.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring"
              placeholder="Type any sentence..."
              disabled={isBusy}
            />
            <button
              type="submit"
              className="mt-3 rounded-xl border border-emerald-400/60 px-3 py-2 text-sm font-semibold text-emerald-100 disabled:opacity-60"
              disabled={isBusy || !textInput.trim()}
            >
              Translate Text
            </button>
          </form>
        </div>
      </section>

      <section className="mt-5 flex-1 rounded-3xl border border-slate-700 bg-slate-900/60 p-4 md:p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">Conversation</h3>
          <p className="text-xs text-slate-400">Newest first</p>
        </div>

        <div className="space-y-3">
          {messages.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
              Share an audio file from WhatsApp or record a voice note to begin.
            </p>
          )}

          {messages.map((message) => (
            <article key={message.id} className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                <span>{message.kind.toUpperCase()}</span>
                <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
              </div>
              <p className="rounded-xl bg-slate-800 p-3 text-sm text-slate-100">{message.original}</p>
              <p className="mt-2 rounded-xl bg-cyan-900/40 p-3 text-sm text-cyan-100">{message.translated}</p>
              <p className="mt-2 text-xs text-slate-400">
                {message.sourceLanguage} {"->"} {message.targetLanguage}
              </p>
            </article>
          ))}
        </div>
      </section>

      {showInstallPrompt && (
        <aside className="fixed inset-x-4 bottom-4 z-20 rounded-2xl border border-cyan-300/30 bg-slate-900 p-4 shadow-glow">
          <p className="text-sm text-slate-100">Install on iPhone: tap Safari Share, then "Add to Home Screen".</p>
          <button
            type="button"
            onClick={() => setShowInstallPrompt(false)}
            className="mt-2 rounded-lg border border-slate-500 px-2 py-1 text-xs text-slate-300"
          >
            Dismiss
          </button>
        </aside>
      )}
    </main>
  );
}

export default App;
