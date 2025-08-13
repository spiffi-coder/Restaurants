import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Plus, Star, Trash2, MapPin, CalendarPlus, Camera, Share2, CheckCircle2, Search, Settings, NotebookPen } from 'lucide-react';
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

// ====== Service Worker for offline caching ======
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

// ====== IndexedDB setup ======
const DB_NAME = 'restaurantJournal';
const DB_VERSION = 1;
const STORE_NAME = 'restaurants';

async function initDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('by-date', 'date');
      }
    }
  });
}

function LocationMarker({ setPosition }) {
  useMapEvents({
    click(e) {
      setPosition(e.latlng);
    }
  });
  return null;
}

export default function App() {
  const [restaurants, setRestaurants] = useState([]);
  const [selected, setSelected] = useState(null);
  const [position, setPosition] = useState(null);
  const [db, setDb] = useState(null);

  useEffect(() => {
    initDB().then(setDb);
  }, []);

  useEffect(() => {
    if (db) {
      db.getAll(STORE_NAME).then(setRestaurants);
    }
  }, [db]);

  async function addRestaurant(name, notes, latlng) {
    const newRestaurant = {
      id: uuidv4(),
      name,
      notes,
      date: new Date().toISOString(),
      lat: latlng.lat,
      lng: latlng.lng
    };
    await db.add(STORE_NAME, newRestaurant);
    setRestaurants([...restaurants, newRestaurant]);
  }

  return (
    <div style={{ height: '100vh', display: 'flex' }}>
      <MapContainer center={[20, 0]} zoom={2} style={{ flex: 1 }}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
        />
        {restaurants.map(r => (
          <Marker key={r.id} position={[r.lat, r.lng]}>
            <Popup>
              <b>{r.name}</b><br />
              {r.notes}
            </Popup>
          </Marker>
        ))}
        <LocationMarker setPosition={setPosition} />
      </MapContainer>
      {/* Right-hand panel or modal for adding restaurants, taking photos, and notes can go here */}
    </div>
  );
}
