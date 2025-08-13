import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Plus, Star, Trash2, MapPin, CalendarPlus, Camera, Images, Share2, CheckCircle2, Download, Upload as UploadIcon, Search, Settings, NotebookPen } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import exifr from 'exifr';
import { openDB } from 'idb';

// ---------- IndexedDB (idb) ----------
const DB_NAME = 'restaurant-journal-v2';
const DB_VERSION = 2;
const STORE_RESTAURANTS = 'restaurants';
const STORE_PHOTOS = 'photos'; // { id, blob, type }

async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_RESTAURANTS)) {
        db.createObjectStore(STORE_RESTAURANTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
        db.createObjectStore(STORE_PHOTOS, { keyPath: 'id' });
      }
    }
  });
}
async function putRestaurants(list) {
  const db = await getDB();
  const tx = db.transaction(STORE_RESTAURANTS, 'readwrite');
  for (const r of list) await tx.store.put(r);
  await tx.done;
}
async function getAllRestaurants() {
  const db = await getDB();
  return db.getAll(STORE_RESTAURANTS);
}
async function deleteRestaurantRow(id) {
  const db = await getDB();
  await db.delete(STORE_RESTAURANTS, id);
}
async function putPhotoBlob(id, blob) {
  const db = await getDB();
  await db.put(STORE_PHOTOS, { id, blob, type: blob.type });
}
async function getPhotoBlob(id) {
  const db = await getDB();
  const v = await db.get(STORE_PHOTOS, id);
  return v ? v.blob : null;
}
async function deletePhotoBlob(id) {
  const db = await getDB();
  await db.delete(STORE_PHOTOS, id);
}

// ---------- Utils ----------
const formatDateTime = (ms) => new Date(ms).toLocaleString();

function Toasts({ items }) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[1000] space-y-2 pointer-events-none">
      {items.map(t => (
        <div key={t.id} className="px-4 py-2 rounded-full bg-black/80 text-white text-sm shadow flex items-center gap-2 w-max mx-auto">
          <CheckCircle2 className="h-4 w-4"/> {t.text}
        </div>
      ))}
    </div>
  );
}

async function compressImage(fileOrBlob, maxSide=1600, quality=0.82) {
  const bmp = await createImageBitmap(fileOrBlob);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'); ctx.drawImage(bmp, 0, 0, w, h);
  return new Promise(res => canvas.toBlob(b => res(b || fileOrBlob), 'image/jpeg', quality));
}
async function saveOriginalToDevice(blob, filename=`photo-${Date.now()}.jpg`) {
  try {
    const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files:[file] }) && navigator.share) {
      await navigator.share({ files:[file], title:'Save photo' });
      return true;
    }
  } catch {}
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
    return true;
  } catch {}
  return false;
}
async function shareManyFiles(blobs, base='photo') {
  const files = blobs.map((b,i)=> new File([b], `${base}-${i+1}.jpg`, { type: b.type || 'image/jpeg' }));
  if (navigator.canShare && navigator.canShare({ files }) && navigator.share) {
    await navigator.share({ files, title:'Share photos' }); return true;
  }
  for (const f of files) {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a'); a.href=url; a.download=f.name; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  }
  return false;
}

// ---------- Google Places (plain) ----------
function loadPlacesScriptOnce(key) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.places) return resolve();
    const existing = document.querySelector('script[data-gmaps="1"]');
    if (existing) {
      existing.addEventListener('load', ()=>resolve());
      existing.addEventListener('error', ()=>reject(new Error('Failed to load Google Maps script')));
      return;
    }
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places`;
    s.async = true; s.defer = true; s.setAttribute('data-gmaps','1');
    s.onload = () => resolve(); s.onerror = () => reject(new Error('Failed to load Google Maps script'));
    document.head.appendChild(s);
  });
}

// ---------- Small UI helpers ----------
function Stars({ value, onChange }) {
  return (
    <div className="flex items-center gap-1">
      {[1,2,3,4,5].map(n => (
        <Star key={n} className={`h-5 w-5 cursor-pointer ${value >= n ? 'fill-current' : ''}`} onClick={()=> onChange?.(n)} />
      ))}
    </div>
  );
}
function ClickToSet({ onSet }) {
  useMapEvents({ click(e){ onSet(e.latlng.lat, e.latlng.lng); } });
  return null;
}

// ---------- PWA (manifest + SW) ----------
function usePWA() {
  useEffect(() => {
    try {
      if (!document.querySelector('link[rel="manifest"]')) {
        const manifest = { name:'Restaurant Journal', short_name:'RJournal', start_url:'.', display:'standalone', background_color:'#ffffff', theme_color:'#0ea5e9', description:'Private restaurant journal.', icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ] };
        const blob = new Blob([JSON.stringify(manifest)], { type:'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('link'); link.rel='manifest'; link.href=url; document.head.appendChild(link);
      }
      if ('serviceWorker' in navigator) {
        const swCode = `const APP_CACHE='rjournal-v2'; const TILE='rjournal-tiles-v1';
self.addEventListener('install',e=>{e.waitUntil(caches.open(APP_CACHE).then(c=>c.addAll(['./','icon-192.png','icon-512.png'])).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>![APP_CACHE,TILE].includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request; if(r.method!=='GET') return; const u=new URL(r.url); if(u.origin===location.origin){e.respondWith(caches.match(r).then(x=>x||fetch(r).then(resp=>{const cp=resp.clone(); caches.open(APP_CACHE).then(c=>c.put(r,cp)); return resp}).catch(()=>caches.match('./'))))} else if (u.hostname.endsWith('tile.openstreetmap.org')){e.respondWith(caches.match(r).then(x=>x||fetch(r).then(resp=>{const cp=resp.clone(); caches.open(TILE).then(c=>c.put(r,cp)); return resp})))}});`;
        const blob = new Blob([swCode], { type:'text/javascript' });
        const swUrl = URL.createObjectURL(blob);
        navigator.serviceWorker.register(swUrl, { scope:'./' }).catch(()=>{});
      }
    } catch {}
  }, []);
}

// ---------- App ----------
export default function App() {
  usePWA();

  const [toasts, setToasts] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [openForm, setOpenForm] = useState(false);
  const [draft, setDraft] = useState({ rating:0, photos:[], visits:[] });

  const [q, setQ] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [showFavOnly, setShowFavOnly] = useState(false);

  const [placesKey, setPlacesKey] = useState(()=> localStorage.getItem('rj.placesKey') || '');
  const [placesLoaded, setPlacesLoaded] = useState(false);
  const placesInputRef = useRef(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [facingMode, setFacingMode] = useState('environment');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [compressMax, setCompressMax] = useState(1600);
  const [compressQuality, setCompressQuality] = useState(0.82);
  const [saveFullSizeToDevice, setSaveFullSizeToDevice] = useState(false);

  function showToast(text){ const item={id:uuidv4(), text}; setToasts(t=>[...t,item]); setTimeout(()=> setToasts(t=> t.filter(x=>x.id!==item.id)), 2600); }

  // Load restaurants
  useEffect(()=>{ (async()=>{ const all = await getAllRestaurants(); setRestaurants(all.sort((a,b)=> (b.createdAt||0)-(a.createdAt||0))); })(); },[]);
  // Load Google Places
  useEffect(()=>{ (async()=>{ if (!placesKey) return; try { await loadPlacesScriptOnce(placesKey); setPlacesLoaded(true); } catch { setPlacesLoaded(false); } })(); }, [placesKey]);
  // Wire autocomplete
  useEffect(()=> {
    if (!openForm || !placesLoaded || !placesInputRef.current) return;
    const g = window.google;
    if (!g?.maps?.places) return;
    const input = placesInputRef.current;
    const ac = new g.maps.places.Autocomplete(input, { fields:['name','geometry','formatted_address'] });
    const listener = ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      const name = place?.name || draft.name || '';
      const lat = place?.geometry?.location?.lat?.();
      const lng = place?.geometry?.location?.lng?.();
      setDraft(d => ({ ...d, name, lat: typeof lat==='number'?lat:d.lat, lng: typeof lng==='number'?lng:d.lng }));
    });
    return () => { listener && listener.remove && listener.remove(); };
  }, [openForm, placesLoaded]);

  async function persist(list){ setRestaurants(list); await putRestaurants(list); }

  function startNew(lat, lng) {
    const now = Date.now();
    setDraft({ id: undefined, name:'', rating:0, notes:'', photos:[], lat, lng, favorite:false, createdAt: now, visits: [now] });
    setOpenForm(true);
  }
  function saveDraft() {
    if (!draft.name || draft.name.trim()==='') return;
    const now = Date.now();
    if (!draft.id) {
      const r = { id:uuidv4(), name:draft.name.trim(), rating:draft.rating||0, notes:draft.notes||'', photos:draft.photos||[], lat:draft.lat, lng:draft.lng, favorite: !!draft.favorite, createdAt: now, visits: draft.visits && draft.visits.length? draft.visits : [now] };
      persist([r, ...restaurants]); setActiveId(r.id); showToast('Saved entry');
    } else {
      const updated = restaurants.map(x => x.id===draft.id ? { ...x, ...draft, name: (draft.name||'').trim(), photos: draft.photos||[], visits: draft.visits && draft.visits.length ? draft.visits : (x.visits||[]) } : x);
      persist(updated); showToast('Updated entry');
    }
    setOpenForm(false);
  }
  function deleteRestaurantAll(id) {
    const r = restaurants.find(x=>x.id===id);
    const updated = restaurants.filter(x=>x.id!==id);
    persist(updated);
    if (activeId===id) setActiveId(null);
    Promise.all((r?.photos||[]).map(p=> deletePhotoBlob(p.id))).then(()=>{});
    showToast('Deleted');
  }

  // Camera lifecycle
  useEffect(()=> {
    if (!cameraOpen) return;
    (async()=>{ try { if (streamRef.current) stopCamera(); const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } }); streamRef.current = stream; if (videoRef.current) videoRef.current.srcObject = stream; } catch {} })();
    return ()=> { stopCamera(); };
  }, [cameraOpen, facingMode]);
  function stopCamera(){ try { streamRef.current?.getTracks().forEach(t=>t.stop()); } catch {} streamRef.current=null; }
  async function captureFromVideo() {
    if (!videoRef.current) return;
    let originalBlob = null;
    try {
      const track = streamRef.current?.getVideoTracks?.()[0];
      if (window.ImageCapture && track) { const ic = new ImageCapture(track); originalBlob = await ic.takePhoto(); }
    } catch {}
    try {
      if (!originalBlob) {
        const v = videoRef.current; const w = v.videoWidth, h = v.videoHeight;
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d'); ctx.drawImage(v,0,0,w,h);
        originalBlob = await new Promise(res => canvas.toBlob(b=>res(b), 'image/jpeg', compressQuality));
      }
      if (saveFullSizeToDevice) { const ok = await saveOriginalToDevice(originalBlob); if (ok) showToast('Saved original to device'); }
      const compressed = await compressImage(originalBlob, compressMax, compressQuality);
      const id = uuidv4(); await putPhotoBlob(id, compressed);
      setDraft(d=> ({ ...d, photos: [ ...(d.photos||[]), { id, note:'' } ] }));
      showToast('Photo added to entry');
    } catch {}
  }

  async function handleFiles(files) {
    if (!files || !files.length) return;
    for (const file of Array.from(files)) {
      try {
        if (saveFullSizeToDevice) { const ok = await saveOriginalToDevice(file, file.name || `photo-${Date.now()}.jpg`); if (ok) showToast('Saved original to device'); }
        let exifDate = undefined;
        try {
          const meta = await exifr.parse(file, { pick:['DateTimeOriginal'] });
          if (meta?.DateTimeOriginal instanceof Date) exifDate = meta.DateTimeOriginal.getTime();
        } catch {}
        const blob = await compressImage(file, compressMax, compressQuality);
        const id = uuidv4(); await putPhotoBlob(id, blob);
        setDraft(d=> ({ ...d, photos: [ ...(d.photos||[]), { id, note:'', exifDate } ], visits: Array.from(new Set([...(d.visits||[]), ...(exifDate?[exifDate]:[])])) }));
        showToast('Photo added to entry');
      } catch {}
    }
  }

  async function exportJson() {
    const allIds = Array.from(new Set(restaurants.flatMap(r => (r.photos||[]).map(p=>p.id))));
    const photos = [];
    for (const id of allIds) {
      const b = await getPhotoBlob(id); if (!b) continue;
      const dataURL = await new Promise(res => { const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.readAsDataURL(b); });
      photos.push({ id, dataURL });
    }
    const payload = { version: 8, restaurants, photos };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='restaurant-journal-backup.json'; a.click(); URL.revokeObjectURL(url);
    showToast('Exported');
  }
  function importJsonFile(file) {
    const fr = new FileReader();
    fr.onload = async () => {
      try {
        const parsed = JSON.parse(fr.result);
        if (parsed && Array.isArray(parsed.restaurants) && Array.isArray(parsed.photos)) {
          for (const p of parsed.photos) { const res = await fetch(p.dataURL); const b = await res.blob(); await putPhotoBlob(p.id, b); }
          await putRestaurants(parsed.restaurants); setRestaurants(parsed.restaurants); showToast('Imported');
        }
      } catch {}
    };
    fr.readAsText(file);
  }

  const filtered = useMemo(()=> restaurants.filter(r =>
    ((r.name||'').toLowerCase().includes(q.toLowerCase()) || (r.notes||'').toLowerCase().includes(q.toLowerCase()))
    && (r.rating||0) >= minRating
    && (!showFavOnly || !!r.favorite)
  ), [restaurants,q,minRating,showFavOnly]);

  const mapCenter = useMemo(()=> {
    const a = restaurants.find(r=> r.id===activeId);
    if (a) return [a.lat ?? 21.3069, a.lng ?? -157.8583];
    if (restaurants.length) return [restaurants[0].lat ?? 21.3069, restaurants[0].lng ?? -157.8583];
    return [21.3069, -157.8583];
  }, [restaurants, activeId]);

  function PhotoThumb({ photo, ownerId }) {
    const [url, setUrl] = useState(null);
    useEffect(()=>{ let revoke=null; (async()=>{ const b = await getPhotoBlob(photo.id); if (!b) return; const obj = URL.createObjectURL(b); revoke=obj; setUrl(obj); })(); return ()=> { if (revoke) URL.revokeObjectURL(revoke); }; }, [photo.id]);
    return (
      <div className="flex flex-col">
        {url ? <img src={url} alt="photo" className="w-full h-24 object-cover rounded"/> : <div className="w-full h-24 bg-slate-200 rounded"/>}
        <input className="mt-1 w-full border rounded px-2 py-1 text-sm" placeholder="Add a note…" value={photo.note||''}
               onChange={(e)=> setRestaurants(prev => prev.map(r=> r.id===ownerId ? { ...r, photos: (r.photos||[]).map(ph=> ph.id===photo.id? { ...ph, note: e.target.value } : ph) } : r))} />
      </div>
    );
  }

  async function shareAllPhotos(r) {
    const blobs = [];
    for (const p of (r.photos||[])) { const b = await getPhotoBlob(p.id); if (b) blobs.push(b); }
    if (!blobs.length) return showToast('No photos to share');
    const ok = await shareManyFiles(blobs, r.name.replace(/\\s+/g,'-').toLowerCase());
    if (ok) showToast('Opened share sheet'); else showToast('Started downloads');
  }

  return (
    <div className="min-h-screen w-full grid md:grid-cols-5" style={{fontFamily:'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif'}}>
      <Toasts items={toasts} />

      {/* Sidebar */}
      <div className="md:col-span-2 p-4 md:p-6 border-r">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold tracking-tight">My Restaurant Journal</h1>
        <div className="flex items-center gap-2">
          <button className="border px-3 py-2 rounded" onClick={exportJson}><Download className="h-4 w-4 inline mr-2"/>Export</button>
          <label className="inline-flex">
            <input type="file" accept="application/json" className="hidden" onChange={(e)=> e.target.files && importJsonFile(e.target.files[0])} />
            <span className="border px-3 py-2 rounded cursor-pointer"><UploadIcon className="h-4 w-4 inline mr-2"/>Import</span>
          </label>
          <button className="border px-3 py-2 rounded" onClick={()=>{ const key=prompt('Paste your Google Maps JavaScript API key'); if (key){ localStorage.setItem('rj.placesKey', key); setPlacesKey(key); showToast('Saved Places key'); } }}><Settings className="h-4 w-4 inline mr-2"/>Places</button>
          <button className="px-3 py-2 rounded bg-blue-600 text-white" onClick={()=> startNew()}><Plus className="h-4 w-4 inline mr-2"/>New</button>
        </div>
        </div>

        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4"/>
            <input className="pl-8 border px-2 py-2 rounded w-full" placeholder="Search name or notes" value={q} onChange={(e)=> setQ(e.target.value)} />
          </div>
          <div className="w-48 flex items-center gap-2 text-sm">
            <span className="text-xs">Min Rating</span>
            <input type="range" min={0} max={5} step={1} value={minRating} onChange={(e)=> setMinRating(parseInt(e.target.value))} />
            <span className="text-xs">{minRating}</span>
          </div>
          <button className={`px-3 py-2 rounded border ${showFavOnly? 'bg-blue-600 text-white':''}`} onClick={()=> setShowFavOnly(v=>!v)}><Star className="h-4 w-4 inline mr-2"/>Favorites</button>
        </div>

        <div className="h-[calc(100vh-220px)] overflow-auto pr-2">
          <div className="grid gap-3">
            {filtered.length===0 && (
              <div className="border-dashed border p-6 text-sm text-slate-500 rounded">No restaurants yet. Click <strong>New</strong> or tap on the map to start at that spot.</div>
            )}
            {filtered.map(r => (
              <div key={r.id} className={`cursor-pointer transition hover:shadow border rounded ${activeId===r.id? 'ring-2 ring-slate-400':''}`} onClick={()=> setActiveId(r.id)}>
                <div className="p-3 border-b">
                  <div className="flex items-center justify-between">
                    <div className="font-medium truncate flex items-center gap-2">{r.favorite && <span>⭐</span>}{r.name}</div>
                    <span className="text-xs inline-flex items-center border rounded px-2 py-1"><Star className="h-3 w-3 mr-1"/>{r.rating||0}</span>
                  </div>
                  <div className="text-xs text-slate-500">{formatDateTime(r.createdAt||Date.now())}</div>
                </div>
                <div className="p-3 text-sm text-slate-700">
                  <div className="line-clamp-2">{r.notes || <em>No notes</em>}</div>
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <MapPin className="h-3 w-3"/> {(r.lat??21.3069).toFixed(4)}, {(r.lng??-157.8583).toFixed(4)}
                    <span className="h-4 w-px bg-slate-300"/>
                    <Images className="h-3 w-3"/> {(r.photos||[]).length}
                    <span className="h-4 w-px bg-slate-300"/>
                    <CalendarPlus className="h-3 w-3"/> {(r.visits||[]).length} visits
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button className="border px-3 py-1 rounded text-xs" onClick={()=> { setDraft(r); setOpenForm(true); }}>Edit</button>
                    <button className={`border px-3 py-1 rounded text-xs ${r.favorite?'bg-blue-600 text-white':''}`} onClick={async()=>{ const updated = restaurants.map(x => x.id===r.id? { ...x, favorite: !x.favorite } : x); await persist(updated); }}>{r.favorite?'Unfavorite':'Favorite'}</button>
                    {(r.photos||[]).length>0 && <button className="border px-3 py-1 rounded text-xs" onClick={()=> shareAllPhotos(r)}><Share2 className="h-3 w-3 inline mr-1"/>Share Photos</button>}
                    <button className="border px-3 py-1 rounded text-xs text-red-600" onClick={()=> deleteRestaurantAll(r.id)}><Trash2 className="h-3 w-3 inline mr-1"/>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="md:col-span-3 relative">
        <MapContainer center={mapCenter} zoom={13} className="h-[calc(100vh-0px)] w-full">
          <TileLayer attribution='© OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <ClickToSet onSet={(lat,lng)=> startNew(lat,lng)} />
          {restaurants.map(r => (
            <CircleMarker key={r.id} center={[r.lat??21.3069, r.lng??-157.8583]} radius={8} pathOptions={{}} eventHandlers={{ click: ()=> setActiveId(r.id) }}>
              <Popup>
                <div className="min-w-[220px]">
                  <div className="font-medium mb-1 flex items-center justify-between">
                    <span>{r.name}</span>
                    <span className="inline-flex items-center text-xs"><Star className="h-3 w-3 mr-1"/>{r.rating||0}</span>
                  </div>
                  <div className="text-xs text-slate-500 mb-2 line-clamp-3">{r.notes || <em>No notes</em>}</div>
                  <div className="flex items-center gap-2">
                    <button className="border rounded px-2 py-1 text-xs" onClick={()=> setActiveId(r.id)}>View</button>
                    <button className="border rounded px-2 py-1 text-xs" onClick={()=> { setDraft(r); setOpenForm(true); }}>Edit</button>
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
        <div className="absolute bottom-4 right-4 flex flex-col gap-2">
          <button className="px-4 py-3 rounded-full shadow-lg bg-blue-600 text-white" onClick={()=> startNew()}><Plus className="h-5 w-5 inline mr-2"/>Add</button>
        </div>
      </div>

      {/* Dialog: Create/Edit */}
      {openForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[200]" onClick={()=> setOpenForm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl p-4" onClick={(e)=> e.stopPropagation()}>
            <div className="text-lg font-semibold mb-1">{draft?.id? 'Edit Entry' : 'New Restaurant'}</div>
            <div className="text-xs text-slate-500 mb-4">Search with Google Places, set the pin, add photos (with notes). Everything stays on your device.</div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div>
                  <div className="text-sm mb-1">Name</div>
                  <input className="border px-2 py-2 rounded w-full" value={draft.name||''} onChange={(e)=> setDraft({ ...draft, name: e.target.value })} placeholder="Restaurant name" />
                </div>
                <div>
                  <div className="text-sm mb-1">Search Google Places</div>
                  <input ref={placesInputRef} disabled={!placesLoaded} className="border px-2 py-2 rounded w-full" placeholder={placesLoaded? 'Type a place name…':'Click Places and paste your API key'} />
                </div>
                <div>
                  <div className="text-sm mb-1">Rating</div>
                  <Stars value={draft.rating||0} onChange={(v)=> setDraft({ ...draft, rating: v })} />
                  <label className="inline-flex items-center gap-2 text-xs mt-2"><input type="checkbox" checked={!!draft.favorite} onChange={(e)=> setDraft({ ...draft, favorite: e.target.checked })} /> Favorite</label>
                </div>
                <div>
                  <div className="text-sm mb-1">Notes</div>
                  <textarea className="border px-2 py-2 rounded w-full" rows={6} value={draft.notes||''} onChange={(e)=> setDraft({ ...draft, notes: e.target.value })} placeholder="What did you eat? Service, vibes, tips…" />
                </div>
                <div>
                  <div className="text-sm mb-1">Photos</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="inline-flex">
                      <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e)=> handleFiles(e.target.files)} />
                      <span className="border px-3 py-2 rounded cursor-pointer"><Camera className="h-4 w-4 inline mr-2"/>Take photo (back)</span>
                    </label>
                    <label className="inline-flex">
                      <input type="file" accept="image/*" capture="user" multiple className="hidden" onChange={(e)=> handleFiles(e.target.files)} />
                      <span className="border px-3 py-2 rounded cursor-pointer"><Camera className="h-4 w-4 inline mr-2"/>Take photo (front)</span>
                    </label>
                    <label className="inline-flex">
                      <input type="file" accept="image/*" multiple className="hidden" onChange={(e)=> handleFiles(e.target.files)} />
                      <span className="border px-3 py-2 rounded cursor-pointer"><Images className="h-4 w-4 inline mr-2"/>Add from gallery</span>
                    </label>
                  </div>
                  {(draft.photos||[]).length>0 && (
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {(draft.photos||[]).map(p => (
                        <PhotoThumb key={p.id} photo={p} ownerId={draft.id||'__draft__'} />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-sm mb-1">Pick Location</div>
                <div className="rounded-2xl overflow-hidden border">
                  <MapContainer center={[(draft.lat ?? 21.3069), (draft.lng ?? -157.8583)]} zoom={14} className="h-72 w-full">
                    <TileLayer attribution='© OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
                    {typeof draft.lat==='number' && typeof draft.lng==='number' && (<CircleMarker center={[draft.lat, draft.lng]} radius={10} pathOptions={{}} />)}
                    <ClickToSet onSet={(lat,lng)=> setDraft({ ...draft, lat, lng })} />
                  </MapContainer>
                </div>
                <div className="text-sm text-slate-500 flex items-center gap-2"><MapPin className="h-4 w-4"/> {typeof draft.lat==='number'? draft.lat.toFixed(5):'—'}, {typeof draft.lng==='number'? draft.lng.toFixed(5):'—'}</div>
                <div className="border rounded p-3">
                  <div className="text-sm font-medium flex items-center"><NotebookPen className="h-4 w-4 mr-2"/>Tips</div>
                  <div className="text-xs text-slate-500 mt-1">• EXIF dates add to visit history automatically.<br/>• Export to back up all data (including photos).<br/>• Install as PWA from your browser menu.</div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button className="border px-4 py-2 rounded" onClick={()=> setOpenForm(false)}>Cancel</button>
              <button className="px-4 py-2 rounded bg-blue-600 text-white" onClick={saveDraft} disabled={!draft.name || draft.name.trim()===''}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
