import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Plus, Star, Trash2, MapPin, CalendarPlus, Camera, Share2, Search, NotebookPen } from 'lucide-react';
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

// ====== Service Worker ======
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

// ====== IndexedDB ======
const DB_NAME = 'restaurantJournal';
const DB_VERSION = 1;
const STORE_NAME = 'restaurants';

async function initDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
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
  const [position, setPosition] = useState(null);
  const [db, setDb] = useState(null);
  const [newName, setNewName] = useState('');
  const [notes, setNotes] = useState('');
  const [rating, setRating] = useState(0);
  const [favorite, setFavorite] = useState(false);
  const [photos, setPhotos] = useState([]);
  const fileInputRef = useRef(null);

  useEffect(() => {
    initDB().then(setDb);
  }, []);

  useEffect(() => {
    if (db) {
      db.getAll(STORE_NAME).then(setRestaurants);
    }
  }, [db]);

  async function addRestaurant() {
    if (!newName || !position) return;
    const newEntry = {
      id: uuidv4(),
      name: newName,
      notes,
      rating,
      favorite,
      lat: position.lat,
      lng: position.lng,
      date: new Date().toISOString(),
      photos
    };
    await db.add(STORE_NAME, newEntry);
    setRestaurants([...restaurants, newEntry]);
    setNewName('');
    setNotes('');
    setRating(0);
    setFavorite(false);
    setPhotos([]);
  }

  async function deleteRestaurant(id) {
    await db.delete(STORE_NAME, id);
    setRestaurants(restaurants.filter(r => r.id !== id));
  }

  function handlePhotoUpload(e) {
    const files = Array.from(e.target.files);
    files.forEach(async file => {
      const dataUrl = await fileToDataUrl(file);
      setPhotos(prev => [...prev, { id: uuidv4(), dataUrl }]);
    });
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = e => reject(e);
      reader.readAsDataURL(file);
    });
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
              <b>{r.name}</b> {r.favorite && <Star fill="gold" />}<br />
              {r.notes}<br />
              Rating: {r.rating} ⭐<br />
              Visited: {new Date(r.date).toLocaleDateString()}<br />
              {r.photos && r.photos.map(p => (
                <img key={p.id} src={p.dataUrl} alt="" style={{ width: '80px', margin: '4px' }} />
              ))}
              <button onClick={() => deleteRestaurant(r.id)}>Delete</button>
            </Popup>
          </Marker>
        ))}
        <LocationMarker setPosition={setPosition} />
      </MapContainer>

      <div style={{ width: '300px', padding: '10px', background: '#f8f9fa', overflowY: 'auto' }}>
        <h3>Add Visit</h3>
        <input
          placeholder="Restaurant Name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
        /><br />
        <textarea
          placeholder="Notes"
          value={notes}
          onChange={e => setNotes(e.target.value)}
        /><br />
        <input
          type="number"
          placeholder="Rating (0-5)"
          value={rating}
          onChange={e => setRating(Number(e.target.value))}
        /><br />
        <label>
          <input
            type="checkbox"
            checked={favorite}
            onChange={e => setFavorite(e.target.checked)}
          /> Favorite
        </label><br />
        <input
          type="file"
          multiple
          accept="image/*"
          ref={fileInputRef}
          onChange={handlePhotoUpload}
        /><br />
        <button onClick={addRestaurant}>Save</button>
      </div>
    </div>
  );
}
