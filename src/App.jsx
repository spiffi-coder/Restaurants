import React, { useCallback, useMemo, useRef, useState } from 'react'
import MapView from './components/MapView.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import PlacesControls from './components/PlacesControls.jsx'
import ResultsList from './components/ResultsList.jsx'

export default function App() {
  const mapRef = useRef(null)

  const [center, setCenter] = useState({ lat: 21.3069, lng: -157.8583 })
  const [zoom, setZoom] = useState(12)
  const [mapTypeId, setMapTypeId] = useState('roadmap')

  const [showTraffic, setShowTraffic] = useState(false)
  const [showTransit, setShowTransit] = useState(false)
  const [showBicycling, setShowBicycling] = useState(false)

  const [results, setResults] = useState([])
  const [markers, setMarkers] = useState([])

  const mapOptions = useMemo(() => ({
    center,
    zoom,
    mapTypeId,
    disableDefaultUI: false,
    clickableIcons: true,
  }), [center, zoom, mapTypeId])

  const onUseMyLocation = useCallback(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        setCenter({ lat: latitude, lng: longitude })
        setZoom((z) => Math.max(z, 14))
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }, [])

  const handleResults = (items) => {
    setResults(items)
    setMarkers(items.map(i => ({
      position: i.position,
      title: i.name,
      placeId: i.placeId,
      onClick: (m) => focusItem(m),
    })))
  }

  const focusItem = (item) => {
    setCenter(item.position)
    setZoom(16)
  }

  return (
    <div className="app">
      <div className="map-wrap" style={{ position: 'relative' }}>
        <MapView
          ref={mapRef}
          options={mapOptions}
          showTraffic={showTraffic}
          showTransit={showTransit}
          showBicycling={showBicycling}
          onCenterChanged={setCenter}
          onZoomChanged={setZoom}
          onMapReady={() => {}}
          markers={markers}
        />

        {/* Floating search controls on top of the map */}
        <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', gap: 8, pointerEvents: 'none' }}>
          <div style={{ pointerEvents: 'auto', flex: 1, maxWidth: 520 }}>
            <PlacesControls
              mapGetter={() => mapRef.current?.getMap?.()}
              onResults={handleResults}
            />
          </div>
        </div>

        {/* Results list docked bottom-left on the map */}
        <div style={{ position: 'absolute', left: 12, bottom: 12, width: 360, maxHeight: 280, overflow: 'auto', pointerEvents: 'auto' }}>
          <ResultsList results={results} onFocus={focusItem} />
        </div>
      </div>

      <SettingsPanel
        center={center}
        zoom={zoom}
        mapTypeId={mapTypeId}
        showTraffic={showTraffic}
        showTransit={showTransit}
        showBicycling={showBicycling}
        onChangeMapType={setMapTypeId}
        onToggleTraffic={() => setShowTraffic((v) => !v)}
        onToggleTransit={() => setShowTransit((v) => !v)}
        onToggleBicycling={() => setShowBicycling((v) => !v)}
        onZoomChange={setZoom}
        onCenterChange={setCenter}
        onUseMyLocation={onUseMyLocation}
      />
    </div>
  )
}
