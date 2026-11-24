import { useEffect, useRef, useState } from 'react'
import { ApiError } from './api'
import type { DetailSelection, MetadataClient } from './metadata'
import { defaultSampleQuery, readSelectedSeries, validateSampleQuery } from './sampleViewer'
import type { SampleLocation, SampleQuery, SampleResult } from './sampleViewer'

export function useSampleViewer(client: MetadataClient, onExpired: () => void, onPeriod?: (query: SampleQuery) => void) {
  const [selections, setSelections] = useState<DetailSelection[]>([])
  const selected = selections[0]
  const selectedRef = useRef(false)
  const [query, setQuery] = useState(defaultSampleQuery)
  const [result, setResult] = useState<{ loading: boolean; datasets?: SampleResult[]; error?: string; cutoff?: string }>({ loading: false })
  const [updatedAt, setUpdatedAt] = useState<string>()
  const [sampleLocation, setSampleLocation] = useState<SampleLocation>()
  const controller = useRef<AbortController | null>(null)
  const pin = useRef<{ asOf: string; cutoff: string } | undefined>(undefined)
  useEffect(() => () => controller.current?.abort(), [])

  function cancel() { controller.current?.abort(); controller.current = null }
  function select(selection: DetailSelection) {
    selectMany([selection])
  }
  function selectMany(selections: DetailSelection[], period?: Pick<SampleQuery, 'start' | 'end'>, initialCutoff?: string) {
    const selection = selections[0]
    if (!selection) return
    selectedRef.current = true
    const cutoff = initialCutoff ?? (selections.length === 1 ? selection.cutoff : undefined)
    pin.current = cutoff ? { asOf: selection.asOf, cutoff } : undefined
    const initial = period ? { ...period, asOf: selection.asOf } : defaultSampleQuery(selection.asOf)
    setUpdatedAt(undefined)
    setSelections(selections); setQuery(initial)
    void read(selections, initial)
  }
  function clear() {
    if (!selectedRef.current) return
    cancel(); selectedRef.current = false; pin.current = undefined
    setSelections([]); setResult({ loading: false }); setSampleLocation(undefined)
    setUpdatedAt(undefined)
  }
  function edit(query: SampleQuery) {
    cancel()
    setQuery(query); setResult({ loading: false }); setSampleLocation(undefined)
  }
  async function read(selections: DetailSelection[], query: SampleQuery, refresh = false) {
    if (!selections.length) return
    cancel()
    if (!refresh) setSampleLocation(undefined)
    try { validateSampleQuery(query) } catch (error: unknown) {
      setSampleLocation(undefined)
      setResult({ loading: false, error: error instanceof ApiError ? error.message : 'The sample query is invalid.' })
      return
    }
    onPeriod?.(query)
    const current = new AbortController()
    controller.current = current
    if (refresh) pin.current = undefined
    let resolved = !refresh && pin.current?.asOf === query.asOf ? pin.current.cutoff : undefined
    setResult((previous) => refresh && previous.datasets
      ? { loading: true, datasets: previous.datasets, cutoff: previous.cutoff }
      : { loading: true, cutoff: resolved })
    try {
      if (refresh) client.clear()
      const datasets = await readSelectedSeries(client, selections, query, current.signal, resolved,
        (cutoff) => {
          if (!current.signal.aborted) {
            resolved = cutoff
            pin.current = { asOf: query.asOf, cutoff }
            setResult((previous) => previous.datasets ? previous : { loading: true, cutoff })
          }
        })
      if (!current.signal.aborted) {
        setSampleLocation(undefined)
        setResult({ loading: false, datasets, cutoff: resolved })
        setUpdatedAt(new Date(Date.now()).toISOString())
      }
    } catch (error: unknown) {
      if (current.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) { client.clear(); onExpired() }
      setSampleLocation(undefined)
      setResult({ loading: false, cutoff: resolved, error: error instanceof ApiError ? error.message : 'Samples could not be read. Retry or narrow the UTC range.' })
    } finally {
      if (controller.current === current) controller.current = null
    }
  }
  return {
    selected, selections, query, result, updatedAt, select, selectMany, clear, edit, sampleLocation, setSampleLocation,
    load: (refresh = false) => read(selections, query, refresh),
    applyPeriod: (period: Pick<SampleQuery, 'start' | 'end'>) => {
      const next = { ...query, ...period }
      setQuery(next)
      return read(selections, next)
    },
    cancel: () => {
      cancel()
      setSampleLocation(undefined)
      setResult((current) => ({ loading: false, cutoff: current.cutoff, error: 'Sample read cancelled. No partial plot was displayed.' }))
    },
  }
}
