import React, { useEffect, useState, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Plus, Star, Trash2, Camera, Search, NotebookPen, Settings } from 'lucide-react';
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
  const [searchTerm, setSearchTerm] = useState('');

  // NEW: basemap + Google key
  const [basemap, setBasemap] = useState('osm'); // 'osm' | 'esri' | 'google'
  const [placesKey, setPlacesKey] = useState(() => localStorage.getItem('rj.placesKey') || '');
  const [notice, setNotice] = useState('');

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

  // Simple text search using Google Places Text Search API (centers map)
  async function searchPlaces() {
    if (!searchTerm) return;
    const apiKey = placesKey || 'MISSING_KEY';
    if (apiKey === 'MISSING_KEY') {
      setNotice('Tip: set your Google API key (gear button) for better search/satellite tiles.');
    }
    try {
      const resp = await fetch(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(searchTerm)}&key=${apiKey}`
      );
      const data = await resp.json();
      if (data.results && data.results[0]) {
        const { lat, lng } = data.results[0].geometry.location;
        setPosition({ lat, lng });
      }
    } catch (e) {
      console.error(e);
    }
  }

  // NEW: compute tile layer for selected basemap
  const tileLayer = useMemo(() => {
    if (basemap === 'google') {
      if (!placesKey) {
        // Fallback to Esri if no key yet
        return {
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          attribution: 'Tiles © Esri'
        };
      }
      // Google hybrid (satellite + labels). 's' = satellite, 'y' = hybrid
      return {
        url: `https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&key=${encodeURIComponent(placesKey)}`,
        attribution: '© Google'
      };
    }
    if (basemap === 'esri') {
      return {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles © Esri'
      };
    }
    // default OSM street
    return {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap contributors'
    };
  }, [basemap, placesKey]);

  function saveGoogleKey() {
    const k = prompt('Paste your Google Maps JavaScript API key (used for Places + Google Satellite)');
    if (k) {
      localStorage.setItem('rj.placesKey', k);
      setPlacesKey(k);
      setNotice('Saved Google key.');
    }
  }

  return (
    <div style={{ height: '100vh', display: 'flex', position: 'relative' }}>
      {/* Map */}
      <MapContainer center={[20, 0]} zoom={2} style={{ flex: 1 }}>
        <TileLayer attribution={tileLayer.attribution} url={tileLayer.url} />
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
              <button onClick={() => deleteRestaurant(r.id)} style={{ marginTop: 6, background: '#ef4444' }}>
                <Trash2 size={14} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />
                Delete
              </button>
            </Popup>
          </Marker>
        ))}
        <LocationMarker setPosition={setPosition} />
      </MapContainer>

      {/* Basemap + Places Key controls (top-right overlay) */}
      <div style={{
        position: 'absolute', right: 12, top: 12, background: 'white', padding: 8, borderRadius: 8,
        boxShadow: '0 6px 20px rgba(0,0,0,.15)', display: 'flex', gap: 8, alignItems: 'center'
      }}>
        <label style={{ fontSize: 12 }}>
          Map:
          <select
            value={basemap}
            onChange={e => setBasemap(e.target.value)}
            style={{ marginLeft: 6, padding: '4px 6px' }}
          >
            <option value="osm">Street (OSM)</option>
            <option value="esri">Satellite (Esri)</option>
            <option value="google">Satellite (Google)</option>
          </select>
        </label>
        <button onClick={saveGoogleKey} title="Save Google Places/Maps key" style={{ padding: '6px 10px' }}>
          <Settings size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
          Places API Key
        </button>
      </div>

      {/* Sidebar */}
      <div style={{ width: 320, padding: 12, background: '#f8f9fa', overflowY: 'auto', borderLeft: '1px solid #e5e7eb' }}>
        <h3 style={{ marginTop: 0 }}>Add Visit</h3>
        {notice && (
          <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', padding: 8, borderRadius: 8, fontSize: 12, marginBottom: 8 }}>
            {notice}
          </div>
        )}
        <input
          placeholder="Restaurant Name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
        /><br />
        <textarea
          placeholder="Notes"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={4}
        /><br />
        <input
          type="number"
          placeholder="Rating (0-5)"
          value={rating}
          onChange={e => setRating(Number(e.target.value))}
        /><br />
        <label style={{ display: 'block', marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={favorite}
            onChange={e => setFavorite(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Favorite
        </label>
        <label style={{ display: 'inline-block', marginBottom: 8 }}>
          <input
            type="file"
            multiple
            accept="image/*"
            ref={fileInputRef}
            onChange={handlePhotoUpload}
            style={{ display: 'none' }}
          />
          <button onClick={() => fileInputRef.current?.click()}>
            <Camera size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
            Add Photos
          </button>
        </label>
        <div style={{ marginBottom: 8 }}>
          {photos.map(p => (
            <img key={p.id} src={p.dataUrl} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, marginRight: 6, marginBottom: 6 }} />
          ))}
        </div>
        <button onClick={addRestaurant}>
          <Plus size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
          Save
        </button>

        <h4 style={{ marginTop: 16, marginBottom: 8 }}>
          <Search size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
          Find Restaurant
        </h4>
        <input
          placeholder="Search Places"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
        <button onClick={searchPlaces} style={{ marginTop: 6 }}>
          Search
        </button>

        <div style={{ marginTop: 16, fontSize: 12, color: '#6b7280' }}>
          <NotebookPen size={14} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
          Tip: Map tiles are cached after you view them; app works offline after first load.
        </div>
      </div>
    </div>
  );
}
