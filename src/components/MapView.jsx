import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { Loader } from '@googlemaps/js-api-loader'

const loader = new Loader({
  apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
  version: 'weekly',
  libraries: ['places'],
})

function MapViewImpl(
  {
    options,
    showTraffic,
    showTransit,
    showBicycling,
    onCenterChanged,
    onZoomChanged,
    markers,             // [{ position: {lat, lng}, title, placeId }]
    onMapReady,          // (map, google) => void
  },
  ref
) {
  const mapRef = useRef(null)
  const googleMapRef = useRef(null)
  const trafficLayerRef = useRef(null)
  const transitLayerRef = useRef(null)
  const bicyclingLayerRef = useRef(null)
  const markerObjsRef = useRef([])

  // Expose map to parent
  useImperativeHandle(ref, () => ({
    getMap: () => googleMapRef.current,
    getGoogle: () => window.google,
  }))

  // Initialize
  useEffect(() => {
    let isMounted = true
    loader.load().then((google) => {
      if (!isMounted || !mapRef.current) return
      const map = new google.maps.Map(mapRef.current, options)
      googleMapRef.current = map

      map.addListener('center_changed', () => {
        const c = map.getCenter()
        onCenterChanged({ lat: c.lat(), lng: c.lng() })
      })
      map.addListener('zoom_changed', () => {
        onZoomChanged(map.getZoom())
      })

      onMapReady && onMapReady(map, google)
    })
    return () => { isMounted = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update basic options
  useEffect(() => {
    const map = googleMapRef.current
    if (!map) return
    if (options.center) map.setCenter(options.center)
    if (typeof options.zoom === 'number') map.setZoom(options.zoom)
    if (options.mapTypeId) map.setMapTypeId(options.mapTypeId)
  }, [options])

  // Layers
  useEffect(() => {
    const map = googleMapRef.current
    const g = window.google
    if (!map || !g) return
    if (!trafficLayerRef.current) trafficLayerRef.current = new g.maps.TrafficLayer()
    trafficLayerRef.current.setMap(showTraffic ? map : null)
  }, [showTraffic])

  useEffect(() => {
    const map = googleMapRef.current
    const g = window.google
    if (!map || !g) return
    if (!transitLayerRef.current) transitLayerRef.current = new g.maps.TransitLayer()
    transitLayerRef.current.setMap(showTransit ? map : null)
  }, [showTransit])

  useEffect(() => {
    const map = googleMapRef.current
    const g = window.google
    if (!map || !g) return
    if (!bicyclingLayerRef.current) bicyclingLayerRef.current = new g.maps.BicyclingLayer()
    bicyclingLayerRef.current.setMap(showBicycling ? map : null)
  }, [showBicycling])

  // Render markers
  useEffect(() => {
    const map = googleMapRef.current
    const g = window.google
    if (!map || !g) return

    // clear previous
    markerObjsRef.current.forEach(m => m.setMap(null))
    markerObjsRef.current = []

    if (!markers?.length) return

    const bounds = new g.maps.LatLngBounds()
    markers.forEach((m) => {
      const marker = new g.maps.Marker({
        position: m.position,
        map,
        title: m.title || 'Restaurant',
      })
      if (m.onClick) {
        marker.addListener('click', () => m.onClick(m))
      }
      markerObjsRef.current.push(marker)
      bounds.extend(marker.getPosition())
    })

    if (markers.length > 1) map.fitBounds(bounds)
  }, [markers])

  return <div ref={mapRef} className="map-canvas" />
}

export default forwardRef(MapViewImpl)
