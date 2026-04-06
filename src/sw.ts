/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { NetworkFirst } from "workbox-strategies";

declare const self: ServiceWorkerGlobalScope;

const wbManifest = (self as ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<unknown> }).__WB_MANIFEST;

precacheAndRoute(wbManifest);
cleanupOutdatedCaches();
self.skipWaiting();
clientsClaim();

registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: "html-cache"
    })
  )
);

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname === "/share-target" && event.request.method === "POST") {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  if (url.pathname === "/shared-audio") {
    if (event.request.method === "GET") {
      event.respondWith(readSharedAudio());
      return;
    }

    if (event.request.method === "DELETE") {
      event.respondWith(deleteSharedAudio());
    }
  }
});

async function handleShareTarget(request: Request): Promise<Response> {
  const formData = await request.formData();
  const file = formData.get("audio");

  if (file instanceof File) {
    const cache = await caches.open("shared-audio-cache");
    await cache.put(
      "/shared-audio",
      new Response(file, {
        headers: {
          "Content-Type": file.type || "audio/ogg",
          "Content-Length": `${file.size}`
        }
      })
    );
  }

  return Response.redirect("/?share-target=1", 303);
}

async function readSharedAudio(): Promise<Response> {
  const cache = await caches.open("shared-audio-cache");
  const response = await cache.match("/shared-audio");

  if (!response) {
    return new Response("No shared audio found", { status: 404 });
  }

  return response;
}

async function deleteSharedAudio(): Promise<Response> {
  const cache = await caches.open("shared-audio-cache");
  await cache.delete("/shared-audio");
  return new Response(null, { status: 204 });
}
