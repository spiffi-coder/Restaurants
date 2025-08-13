import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Plus, Star, Trash2, MapPin, CalendarPlus, Camera, Images, Share2, CheckCircle2, Download, Upload as UploadIcon, Search, Settings, NotebookPen } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import exifr from 'exifr';
import { openDB } from 'idb';

// ====== Inline PWA manifest ======
const manifest = {
  name: "Restaurant Journal",
  short_name: "RJournal",
  start_url: ".",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#2563eb",
  icons: [
    { src: "icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png" }
  ]
};
const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
const manifestURL = URL.createObjectURL(blob);
const link = document.createElement('link');
link.rel = 'manifest';
link.href = manifestURL;
document.head.appendChild(link);

// ====== Service worker for offline support ======
if ('serviceWorker' in navigator) {
  const swCode = `
    const CACHE_NAME = 'rjournal-cache-v2';
    const OFFLINE_URLS = ['./', 'icon-192.png', 'icon-512.png'];

    self.addEventListener('install', event => {
      event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(OFFLINE_URLS)));
    });

    self.addEventListener('fetch', event => {
      const requestURL = new URL(event.request.url);
      if (requestURL.origin.includes('tile.openstreetmap.org')) {
        event.respondWith(
          caches.open('rjournal-tiles').then(cache => 
            cache.match(event.request).then(resp => {
              const fetchPromise = fetch(event.request).then(networkResp => {
                cache.put(event.request, networkResp.clone());
                return networkResp;
              }).catch(() => resp);
              return resp || fetchPromise;
            })
          )
        );
      } else if (requestURL.origin === location.origin) {
        event.respondWith(
          caches.match(event.request).then(resp => resp || fetch(event.request).then(networkResp => {
            return caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, networkResp.clone());
              return networkResp;
            });
          }))
        );
      }
    });
  `;
  const swBlob = new Blob([swCode], { type: 'application/javascript' });
  const swURL = URL.createObjectURL(swBlob);
  navigator.serviceWorker.register(swURL).catch(console.error);
}

// ========= IndexedDB setup, map logic, photo capture, review storage, etc.
// (Rest of your app logic here – same as in our previous working build)
