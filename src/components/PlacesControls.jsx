import React, { useEffect, useRef } from 'react'

export default function PlacesControls({ mapGetter, onResults }) {
  const inputRef = useRef(null)

  // Autocomplete for “restaurants near…”
  useEffect(() => {
    const g = window.google
    const map = mapGetter?.()
    if (!g || !map || !inputRef.current) return

    const ac = new g.maps.places.Autocomplete(inputRef.current, {
      fields: ['geometry', 'name'],
      types: ['establishment'], // or leave empty for broader
    })

    ac.addListener('place_changed', () => {
      const place = ac.getPlace()
      if (place?.geometry?.location) {
        map.panTo(place.geometry.location)
        map.setZoom(15)
        // Optionally trigger a search after moving
        doNearbySearch()
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doNearbySearch = () => {
    const g = window.google
    const map = mapGetter?.()
    if (!g || !map) return

    const service = new g.maps.places.PlacesService(map)
    const center = map.getCenter()

    service.nearbySearch(
      {
        location: center,
        radius: 1500, // meters (~0.9 mi). Increase if you like.
        type: 'restaurant',
        openNow: false,
      },
      (results, status) => {
        if (status !== g.maps.places.PlacesServiceStatus.OK || !results) {
          onResults([])
          return
        }
        const items = results.map(r => ({
          placeId: r.place_id,
          name: r.name,
          position: { lat: r.geometry.location.lat(), lng: r.geometry.location.lng() },
          rating: r.rating,
          address: r.vicinity,
        }))
        onResults(items)
      }
    )
  }

  return (
    <div className="places-controls">
      <input
        ref={inputRef}
        className="places-input"
        placeholder="Search area or place…"
        type="text"
      />
      <button className="btn" type="button" onClick={doNearbySearch}>
        Search restaurants here
      </button>
    </div>
  )
}
