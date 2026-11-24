import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { DockviewPanelApi } from 'dockview'
import { init, use as registerCharts } from 'echarts/core'
import type { EChartsType } from 'echarts/core'
import { CustomChart, LineChart, ScatterChart } from 'echarts/charts'
import type { CustomSeriesOption, LineSeriesOption, ScatterSeriesOption } from 'echarts/charts'
import { AriaComponent, DataZoomInsideComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { format, identity, name, object } from './metadata'
import SampleLegend from './SampleLegend'
import { componentPlotPoints, intervalPlotPoints, occurrenceLabel, plotNumber, plotValue, sampleValueLabel, timestampMicros } from './sampleViewer'
import type { SampleDefinition, SampleLocation, SampleResult } from './sampleViewer'

registerCharts([CustomChart, LineChart, ScatterChart, AriaComponent, DataZoomInsideComponent, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])
const colors = ['#147fa8', '#a14413', '#6652a3']
const overlayColors = [...colors, '#157149', '#9a3267', '#705a13', '#4c6481', '#a02b2b']
const symbols = ['circle', 'rect', 'triangle']
const markerThreshold = 100
const dragThreshold = 4
const maximumDragZoomOutFactor = 5
const grid = { show: true, left: 72, right: 24, top: 36, bottom: 36 }
const zoomControlInset = 8

function usesPeriodBars(definition: SampleDefinition) {
  return definition.sampling === 'equidistant' && definition.statistic === 'total'
}

function currentZoom(chart: EChartsType) {
  const options = chart.getOption().dataZoom
  const zoom = Array.isArray(options) ? options[0] : undefined
  if (object(zoom) && typeof zoom.start === 'number' && typeof zoom.end === 'number' &&
    typeof zoom.startValue === 'number' && typeof zoom.endValue === 'number') {
    return { start: zoom.start, end: zoom.end, startValue: zoom.startValue, endValue: zoom.endValue }
  }
}

function setZoom(chart: EChartsType, start: number, end: number) {
  chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start, end })
}

function scaleZoom(chart: EChartsType, start: number, span: number, factor: number, anchor: number) {
  const nextSpan = Math.min(100, span * factor)
  if (nextSpan === span) return
  const nextStart = Math.max(0, Math.min(100 - nextSpan, start - anchor * (nextSpan - span)))
  setZoom(chart, nextStart, nextStart + nextSpan)
}

function bindMouseGestures(element: HTMLDivElement, chart: EChartsType, allowSampleClicks: boolean,
  clearSelectedTime: (point: [number, number]) => boolean) {
  const listeners = new AbortController()
  const { signal } = listeners
  const selection = document.createElement('div')
  selection.className = 'sample-chart-selection'
  selection.hidden = true
  selection.style.top = `${grid.top}px`
  selection.style.bottom = `${grid.bottom}px`
  element.append(selection)

  let drag: { pointerId: number; button: number; origin: number; left: number; width: number;
    start: number; span: number; lastPanStart: number } | undefined
  let frame = 0
  let dragged = false
  function chartPoint(event: MouseEvent): [number, number] {
    const bounds = element.getBoundingClientRect()
    return [(event.clientX - bounds.left) * chart.getWidth() / bounds.width,
      (event.clientY - bounds.top) * chart.getHeight() / bounds.height]
  }
  function clearDrag() {
    if (!drag) return
    const { pointerId } = drag
    drag = undefined
    selection.hidden = true
    cancelAnimationFrame(frame)
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
  }
  function updatePan(x: number) {
    if (!drag) return
    const { origin, width, start, span } = drag
    const next = Math.max(0, Math.min(100 - span, start - (x - origin) * span / width))
    if (next === drag.lastPanStart) return
    drag.lastPanStart = next
    setZoom(chart, next, next + span)
  }
  function zoomDragEnd(x: number, left: number, width: number) {
    return Math.max(left, Math.min(x, left + width))
  }
  element.addEventListener('pointerdown', (event) => {
    dragged = false
    if (drag || event.pointerType !== 'mouse' || (event.button !== 0 && event.button !== 2)) return
    const point = chartPoint(event)
    if (!chart.containPixel({ gridIndex: 0 }, point)) return
    const zoom = currentZoom(chart)
    if (!zoom) return
    const left = chart.convertToPixel({ xAxisIndex: 0 }, zoom.startValue)
    const right = chart.convertToPixel({ xAxisIndex: 0 }, zoom.endValue)
    if (!(right > left)) return
    drag = { pointerId: event.pointerId, button: event.button, origin: point[0], left,
      width: right - left, start: zoom.start, span: zoom.end - zoom.start, lastPanStart: zoom.start }
    chart.dispatchAction({ type: 'hideTip' })
    if (event.button === 2 || !allowSampleClicks) {
      event.preventDefault()
      event.stopPropagation()
      element.setPointerCapture(event.pointerId)
    }
  }, { capture: true, signal })
  element.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const [x] = chartPoint(event)
    if (drag.button === 2) {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => updatePan(x))
      return
    }
    const end = zoomDragEnd(x, drag.left, drag.width)
    const distance = end - drag.origin
    if (Math.abs(distance) >= dragThreshold && !element.hasPointerCapture(event.pointerId)) {
      element.setPointerCapture(event.pointerId)
    }
    selection.hidden = Math.abs(distance) < dragThreshold || (distance < 0 && drag.span >= 100)
    selection.classList.toggle('sample-chart-selection-out', distance < 0)
    selection.style.left = `${Math.min(drag.origin, end)}px`
    selection.style.width = `${Math.abs(distance)}px`
  }, { signal })
  element.addEventListener('pointerup', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const [x] = chartPoint(event)
    const { button, origin, left, width, start, span } = drag
    if (button === 2) {
      updatePan(x)
    } else {
      const end = zoomDragEnd(x, left, width)
      const distance = end - origin
      dragged = Math.abs(distance) >= dragThreshold
      const anchor = (origin - left) / width
      if (distance >= dragThreshold) {
        setZoom(chart, start + anchor * span, start + (end - left) * span / width)
      } else if (distance <= -dragThreshold) {
        const factor = Math.min(maximumDragZoomOutFactor, width / Math.abs(distance))
        scaleZoom(chart, start, span, factor, anchor)
      }
    }
    clearDrag()
  }, { signal })
  element.addEventListener('click', (event) => {
    if (allowSampleClicks && !dragged && clearSelectedTime(chartPoint(event))) event.stopPropagation()
  }, { capture: true, signal })
  element.addEventListener('pointercancel', clearDrag, { signal })
  element.addEventListener('lostpointercapture', clearDrag, { signal })
  element.addEventListener('pointerleave', (event) => {
    if (drag?.pointerId === event.pointerId && !element.hasPointerCapture(event.pointerId)) clearDrag()
  }, { signal })
  element.addEventListener('contextmenu', (event) => {
    if (drag?.button === 2 || chart.containPixel({ gridIndex: 0 }, chartPoint(event))) event.preventDefault()
  }, { signal })
  return () => { listeners.abort(); clearDrag(); selection.remove() }
}

function showSampleMarkers(sampleTimes: number[], start: number, end: number) {
  let count = 0
  for (const time of sampleTimes) {
    if (time > end) break
    if (time >= start && ++count >= markerThreshold) return false
  }
  return true
}

type ChartData = Pick<SampleResult, 'query' | 'samples' | 'chartDefinition'>
function nearestSample(samples: ChartData['samples'], time: bigint) {
  let first = 0
  let last = samples.length
  while (first < last) {
    const middle = Math.floor((first + last) / 2)
    if (samples[middle]!.micros < time) first = middle + 1
    else last = middle
  }
  const before = samples[first - 1]
  const after = samples[first]
  return before && (!after || time - before.micros <= after.micros - time) ? before : after
}

function boxTextColor(color: string) {
  const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
  const [r, g, b] = rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.179 ? '#000' : '#fff'
}

type LineStyle = 'solid' | 'dashed' | 'dotted'
type Appearance = { color?: string; width?: number; style?: LineStyle }
type AxisSettings = { min?: number; max?: number; inverse: boolean }
type GraphSettings = { traces: Map<string, Appearance>; axes: Map<string, AxisSettings> }
const defaultSettings: GraphSettings = { traces: new Map(), axes: new Map() }

export default function SampleChart({ data, overlays, emptySeries, providerSnapshot = false, sampleLocation, onSampleClick, panelApi, chartLabel }: {
  data: ChartData; overlays?: (ChartData & Partial<Pick<SampleResult, 'node'>>)[]; providerSnapshot?: boolean
  panelApi?: DockviewPanelApi
  chartLabel?: string
  emptySeries?: readonly SampleResult['node'][]
  sampleLocation?: SampleLocation
  onSampleClick?: (location: SampleLocation | undefined) => void
}) {
  const allowSampleClicks = !!onSampleClick
  const selectSample = useEffectEvent((location: SampleLocation | undefined) => onSampleClick?.(location))
  const host = useRef<HTMLDivElement>(null)
  const selectedLine = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsType | undefined>(undefined)
  const settingsDialog = useRef<HTMLDialogElement>(null)
  const settingsTitle = useId()
  const [editingSettings, setEditingSettings] = useState(false)
  const [settings, setSettings] = useState(defaultSettings)
  const [settingsError, setSettingsError] = useState('')
  const [canZoomIn, setCanZoomIn] = useState(false)
  const [canZoomOut, setCanZoomOut] = useState(false)
  function zoomBy(factor: number) {
    const chart = chartRef.current
    const zoom = chart && currentZoom(chart)
    if (chart && zoom) scaleZoom(chart, zoom.start, zoom.end - zoom.start, factor, 0.5)
  }
  const model = useMemo(() => {
    const units = new Map<string, { key: string; name: string; position: 'left' | 'right'; offset: number }>()
    const groups = (overlays ?? [data]).flatMap(({ samples, chartDefinition: definition }, i) => {
      if (!definition || !samples.length) return []
      const node = overlays?.[i]?.node
      const key = JSON.stringify([definition.unitId, definition.unitVersion])
      const yAxisIndex = units.has(key) ? [...units.keys()].indexOf(key) : units.size
      if (!units.has(key)) units.set(key, {
        key, name: definition.unitLabel, position: yAxisIndex % 2 === 0 ? 'left' : 'right', offset: Math.floor(yAxisIndex / 2) * 88,
      })
      return {
        samples, definition, yAxisIndex, color: overlayColors[i]!,
        label: node ? `${name(node)} (${identity(node)})` : definition.name,
      }
    })
    const axisPadding = {
      left: (Math.ceil(units.size / 2) - 1) * 88,
      right: units.size > 1 ? 64 + (Math.floor(units.size / 2) - 1) * 88 : 0,
    }
    return { groups, units: [...units.values()], left: grid.left + axisPadding.left,
      right: grid.right + axisPadding.right, minWidth: axisPadding.left + axisPadding.right + 360 }
  }, [data, overlays])
  const valueBoxes = useMemo(() => sampleLocation ? model.groups.flatMap(({ samples, definition, yAxisIndex, color }, groupIndex) => {
    const sample = nearestSample(samples, sampleLocation.micros)
    if (!sample) return []
    return definition.axes.flatMap(({ axis }, component) => {
      const y = plotValue(sample, component)
      if (y === null) return []
      const background = settings.traces.get(definition.seriesId)?.color ?? (overlays ? color : colors[component]!)
      const trace = overlays ? `${groupIndex}:${axis}` : axis
      const prefix = definition.axes.length > 1 ? `${axis}: ` : ''
      return [{ trace, y, yAxisIndex, background, label: `${prefix}${y} ${definition.unitLabel}`,
        title: `${definition.name} / ${sample.timestamp}` }]
    })
  }) : [], [model, overlays, sampleLocation, settings])
  const updateSelectedLine = useEffectEvent(() => {
    const line = selectedLine.current
    const chart = chartRef.current
    if (!line || !chart) return
    const x = sampleLocation && chart.convertToPixel({ xAxisIndex: 0 }, Number(sampleLocation.micros) / 1000)
    line.hidden = typeof x !== 'number' || !chart.containPixel({ gridIndex: 0 }, [x, chart.getHeight() / 2])
    if (line.hidden || typeof x !== 'number') return
    line.style.left = `${x}px`
    const legend = chart.getOption().legend
    const selected = Array.isArray(legend) && object(legend[0]) && object(legend[0].selected) ? legend[0].selected : {}
    const labels = Array.from(line.querySelectorAll<HTMLElement>('.sample-chart-value-box'))
    const visible = valueBoxes.flatMap(({ trace, y, yAxisIndex }, index) => {
      const label = labels[index]
      const pixel = chart.convertToPixel({ yAxisIndex }, y)
      if (!label) return []
      label.hidden = selected[trace] === false || !chart.containPixel({ gridIndex: 0 }, [x, pixel])
      return label.hidden ? [] : [{ label, pixel, height: label.offsetHeight }]
    }).sort((a, b) => a.pixel - b.pixel)
    const bottom = chart.getHeight() - grid.bottom
    let remaining = visible.reduce((height, item) => height + item.height + 2, 0)
    let next = grid.top
    for (const { label, pixel, height } of visible) {
      const top = Math.max(next, Math.min(pixel - height / 2, bottom - remaining))
      label.style.top = `${top - grid.top}px`
      label.style.left = x + label.offsetWidth + 8 <= chart.getWidth() ? '4px' : `${-label.offsetWidth - 4}px`
      next = top + height + 2
      remaining -= height + 2
    }
  })
  useEffect(() => { updateSelectedLine() }, [valueBoxes])
  const previousView = useRef<{ model: typeof model; zoom: ReturnType<typeof currentZoom>; selected: Record<string, boolean> }>(undefined)
  function applySettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const number = (name: string) => {
      const value = fields.get(name)
      return typeof value === 'string' && value !== '' ? Number(value) : undefined
    }
    const axes = new Map(settings.axes)
    const traces = new Map(settings.traces)
    for (const [index, unit] of model.units.entries()) {
      const min = number(`min-${index}`)
      const max = number(`max-${index}`)
      if ([min, max].some((bound) => bound !== undefined && !Number.isFinite(bound)) ||
          (min !== undefined && max !== undefined && min >= max)) {
        setSettingsError(`Y-axis ${index + 1} (${unit.name}): enter finite bounds with minimum less than maximum.`)
        return
      }
      axes.set(unit.key, { min, max, inverse: fields.has(`inverse-${index}`) })
    }
    model.groups.forEach(({ definition, color: paletteColor }, index) => {
      const color = String(fields.get(`color-${index}`))
      const style = fields.get(`style-${index}`)
      traces.set(definition.seriesId, { color: color === (overlays ? paletteColor : colors[0]) ? undefined : color,
        width: number(`width-${index}`),
        style: style === 'solid' || style === 'dashed' || style === 'dotted' ? style : undefined })
    })
    setSettings({ axes, traces })
    settingsDialog.current?.close()
  }
  useEffect(() => {
    if (editingSettings) settingsDialog.current?.showModal()
  }, [editingSettings])
  const omissions = model.groups.some(({ samples, definition }) => samples.some((sample) => (sample.state === 'valid' &&
    definition.axes.some((_axis, component) => plotValue(sample, component) === null)) ||
    (sample.detectionBound !== null && plotNumber(sample.detectionBound) === null)))
  useEffect(() => {
    const element = host.current
    if (!element) return
    let chart: EChartsType | undefined
    let unbindMouseGestures: (() => void) | undefined
    let min = Number(timestampMicros(data.query.start)) / 1000
    let max = Number(timestampMicros(data.query.end)) / 1000
    const series: (LineSeriesOption | ScatterSeriesOption | CustomSeriesOption)[] = []
    const traces: { samples: SampleResult['samples']; definition: SampleDefinition; linePoints?: ReturnType<typeof componentPlotPoints> }[] = []
    const lineGroups: { ids: string[]; times: number[]; visible: boolean }[] = []
    const durations = new Set<bigint>()
    for (const { samples, definition } of model.groups) {
      for (const { period } of samples) {
        if (!period) continue
        min = Math.min(min, Number(period.startMicros) / 1000)
        max = Math.max(max, Number(period.endMicros) / 1000)
        if (usesPeriodBars(definition)) durations.add(period.endMicros - period.startMicros)
      }
    }
    // Rank actual periods within the bar layer, independently of selection order.
    const barRanks = new Map([...durations].sort((a, b) => a > b ? -1 : a < b ? 1 : 0)
      .map((duration, index) => [duration, index * 2]))
    model.groups.forEach(({ samples, definition, yAxisIndex, color: seriesColor }, groupIndex) => {
    const appearance = settings.traces.get(definition.seriesId)
    const continuous = !definition.position && definition.sampling === 'equidistant'
    const times = continuous ? samples.map(({ micros }) => Number(micros) / 1000) : []
    const markers = { ids: [] as string[], times, visible: showSampleMarkers(times, min, max) }
    if (continuous) lineGroups.push(markers)
    const addTrace = (trace: (typeof series)[number], bar = false, linePoints?: ReturnType<typeof componentPlotPoints>) => {
      series.push({ ...trace, yAxisIndex, z: bar ? 2 : 3 })
      traces.push({ samples, definition, linePoints })
    }
    definition.axes.forEach(({ axis }, component) => {
      const color = appearance?.color ?? (overlays ? seriesColor : colors[component])
      const trace = overlays ? `${groupIndex}:${axis}` : axis
      const itemStyle = { color }
      if (definition.position && samples.some((sample) => sample.period)) {
        const bar = usesPeriodBars(definition)
        const points = intervalPlotPoints(samples, component)
        addTrace({
          type: 'custom', name: trace, clip: true, itemStyle,
          dimensions: ['period start', 'period end', 'value'], encode: { x: [0, 1], y: 2 },
          data: points,
          renderItem: (params, api) => {
            const start = api.coord([api.value(0), api.value(2)])
            const end = api.coord([api.value(1), api.value(2)])
            const period = samples[points[params.dataIndex]!.sampleIndex]?.period
            const z2 = bar && period ? barRanks.get(period.endMicros - period.startMicros) : undefined
            if (bar && api.value(2) !== 0) {
              const zero = api.coord([api.value(0), 0])[1]!
              return { type: 'rect', z2, shape: { x: start[0], y: Math.min(start[1]!, zero),
                width: end[0]! - start[0]!, height: Math.abs(start[1]! - zero) },
              style: { fill: color, opacity: overlays || definition.axes.length > 1 ? 0.7 : 1 } }
            }
            return { type: 'line', z2, shape: { x1: start[0], y1: start[1], x2: end[0], y2: end[1] },
              style: { stroke: color, lineWidth: bar ? 1 : appearance?.width ?? 4,
                lineDash: appearance?.style === 'solid' ? undefined : appearance?.style === 'dashed' ? [8, 3]
                  : appearance?.style === 'dotted' ? [2, 3] : component === 0 ? undefined : component === 1 ? [8, 3] : [2, 3] } }
          },
        }, bar)
        addTrace({
          type: 'scatter', name: trace, itemStyle, symbol: symbols[component], symbolSize: 8,
          data: samples.flatMap((sample, sampleIndex) => {
            const value = plotValue(sample, component)
            const occurrence = sample.occurrence
            return value !== null && occurrence ? [{ value: [Number(timestampMicros(occurrence)) / 1000, value], sampleIndex }] : []
          }),
        })
      } else {
        if (continuous) markers.ids.push(trace)
        const points = componentPlotPoints(samples, component, continuous ? definition.intervalMicros : undefined)
        const options = { id: trace, name: trace, data: points, itemStyle, clip: true, symbol: symbols[component], symbolSize: 6 }
        addTrace(continuous ? {
          ...options, type: 'line', triggerEvent: allowSampleClicks, connectNulls: false,
          showSymbol: markers.visible, showAllSymbol: true,
          lineStyle: { color, width: appearance?.width,
            type: appearance?.style ?? (!overlays || component === 0 ? 'solid' : component === 1 ? 'dashed' : 'dotted') },
        } : { ...options, type: 'scatter' }, false, continuous ? points : undefined)
      }
    })
    for (const state of ['censored_below', 'censored_above'] as const) {
      const bounds = samples.flatMap((sample, sampleIndex) => {
        const value = plotNumber(sample.detectionBound)
        return value !== null && sample.state === state ? [{ value: [Number(sample.micros) / 1000, value], sampleIndex }] : []
      })
      if (bounds.length) addTrace({
        type: 'scatter', name: `${groupIndex}:${state}`, symbol: 'triangle', symbolRotate: state === 'censored_below' ? 180 : 0,
        symbolSize: 10, itemStyle: { color: '#fff', borderColor: overlays ? seriesColor : '#343d47', borderWidth: 2 }, data: bounds,
      })
    }
    })
    function render() {
      if (!element || !element.clientWidth || !element.clientHeight) return
      if (chart) {
        chart.resize()
        // zrender schedules frames in the opener, which can be backgrounded.
        if (element.ownerDocument.defaultView !== window) chart.getZr().flush()
        updateSelectedLine()
        return
      }
      chart = init(element, undefined, { renderer: 'canvas' })
      chartRef.current = chart
      const saved = previousView.current?.model === model ? previousView.current : undefined
      chart.setOption({
        animation: false, useUTC: true,
        aria: { enabled: true, description: chartLabel ?? (providerSnapshot ? 'Offline snapshot of raw provider water levels. Hover over points for exact readings.'
          : 'Read-only scientific time series. Exact timestamps, values, quality, and revisions are available in the Data panel.') },
        legend: { show: false, selected: saved?.selected, data: model.groups.flatMap(({ definition }, groupIndex) =>
          definition.axes.map(({ axis }) => overlays ? `${groupIndex}:${axis}` : axis)) },
        grid: { ...grid, left: model.left, right: model.right },
        xAxis: { type: 'time', name: 'UTC', min, max, axisPointer: { triggerEmphasis: false } },
        yAxis: model.units.map(({ key, ...unit }, index) => ({ type: 'value',
          scale: !model.groups.some(({ definition, yAxisIndex }) => index === yAxisIndex && usesPeriodBars(definition)),
          ...unit, ...settings.axes.get(key), axisLine: { show: !!overlays },
          splitLine: { show: index === 0 } })),
        dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none',
          moveOnMouseMove: !allowSampleClicks,
          startValue: saved?.zoom?.startValue, endValue: saved?.zoom?.endValue }],
        tooltip: {
          trigger: !overlays && lineGroups.length ? 'axis' : 'item', renderMode: 'richText', confine: true,
          axisPointer: { axis: 'x' },
          formatter: (params: unknown) => {
            const point = Array.isArray(params) ? params[0] : params
            const item = object(point) && object(point.data) ? point.data : undefined
            const index = item?.sampleIndex
            const seriesIndex = object(point) ? point.seriesIndex : undefined
            const trace = typeof seriesIndex === 'number' ? traces[seriesIndex] : undefined
            const sample = typeof index === 'number' ? trace?.samples[index] : undefined
            if (!trace || !sample) return 'Declared cadence gap'
            const { definition } = trace
            const occurrence = occurrenceLabel(sample)
            if (providerSnapshot) return `${definition.name}\n${sample.timestamp}\n` +
              `Value: ${sampleValueLabel(sample, definition)} ${definition.unitLabel}\nRaw provider reading`
            return `${definition.name} / ${definition.seriesId}\nPrimary timestamp: ${sample.timestamp}\n` +
              `${definition.level} / ${definition.statistic}${definition.position ? ` / ${definition.position} label` : ''}\n` +
              `${sample.period ? `Period: [${sample.period.start}, ${sample.period.end})\n` : ''}` +
              `${occurrence ? `Occurrence: ${occurrence}${sample.occurrenceReason ? ` (${sample.occurrenceReason})` : ''}\n` : ''}` +
              `Value: ${sampleValueLabel(sample, definition)} ${definition.unitLabel}\n` +
              `State: ${sample.state}` +
              (sample.codebookId ? `\nQuality ${sample.qualityCode}: ${sample.qualityMeaning ?? 'Definition unavailable'}` +
                `\nCodebook: ${sample.codebookId} / v${sample.codebookVersion}` : '') +
              (sample.revision ? `\nSample revision: ${sample.revision}` : '') +
              (definition.version ? `\nSeries metadata: v${definition.version}` : '') +
              `${Object.keys(sample.aggregate).length ? `\nAggregate: ${format(sample.aggregate)}` : ''}`
          },
        },
        series,
      })
      function updateZoom() {
        if (!chart) return
        updateSelectedLine()
        const zoom = currentZoom(chart)
        if (!zoom) return
        setCanZoomIn(zoom.endValue - zoom.startValue > 1)
        setCanZoomOut(zoom.end - zoom.start < 100)
        const updates = lineGroups.flatMap((group) => {
          const visible = showSampleMarkers(group.times, zoom.startValue, zoom.endValue)
          if (visible === group.visible) return []
          group.visible = visible
          return group.ids.map((id) => ({ id, showSymbol: visible }))
        })
        if (updates.length) chart.setOption({ series: updates })
      }
      updateZoom()
      chart.on('datazoom', updateZoom)
      chart.on('legendselected', () => updateSelectedLine())
      chart.on('legendunselected', () => updateSelectedLine())
      if (allowSampleClicks) chart.on('click', 'series', (event) => {
        const trace = event.seriesIndex === undefined ? undefined : traces[event.seriesIndex]
        if (!chart || !trace || !event.event) return
        const { offsetX, offsetY } = event.event
        if (!chart.containPixel({ gridIndex: 0 }, [offsetX, offsetY])) return
        const item: unknown = event.data
        let index = object(item) ? item.sampleIndex : undefined
        if (typeof index !== 'number' && trace.linePoints) {
          const time = chart.convertFromPixel({ xAxisIndex: 0 }, offsetX)
          const points = trace.linePoints
          let first = 0
          let last = points.length
          while (first < last) {
            const middle = Math.floor((first + last) / 2)
            if (points[middle]!.value[0] < time) first = middle + 1
            else last = middle
          }
          const before = points[first - 1]
          const after = points[first]
          const closest = !after || (before && time - before.value[0] <= after.value[0] - time) ? before : after
          if (closest && closest.value[1] !== null) index = closest.sampleIndex
        }
        const sample = typeof index === 'number' ? trace.samples[index] : undefined
        if (sample) selectSample({ seriesId: trace.definition.seriesId, micros: sample.micros })
      })
      unbindMouseGestures = bindMouseGestures(element, chart, allowSampleClicks, ([x, y]) => {
        const line = selectedLine.current
        if (!chart || !line || line.hidden || Math.abs(x - line.offsetLeft) > 4 ||
          !chart.containPixel({ gridIndex: 0 }, [x, y])) return false
        selectSample(undefined)
        return true
      })
    }
    let observer: ResizeObserver | undefined
    let observedWindow: Document['defaultView'] | undefined
    function observeOwner() {
      if (!element) return
      const owner = element.ownerDocument.defaultView
      if (owner === observedWindow) return
      observedWindow = owner
      observer?.disconnect()
      // Dockview adopts the existing panel DOM when moving it between windows.
      observer = new (owner?.ResizeObserver ?? ResizeObserver)(render)
      observer.observe(element)
    }
    observeOwner()
    const location = panelApi?.onDidLocationChange(observeOwner)
    render()
    return () => {
      if (chart) {
        const legend = chart.getOption().legend
        const selection = Array.isArray(legend) && object(legend[0]) && object(legend[0].selected) ? legend[0].selected : {}
        const selected = Object.fromEntries(Object.entries(selection).map(([key, value]) => [key, value === true]))
        previousView.current = { model, zoom: currentZoom(chart), selected }
      }
      location?.dispose()
      observer?.disconnect()
      unbindMouseGestures?.()
      chart?.dispose()
      chartRef.current = undefined
    }
  }, [allowSampleClicks, chartLabel, data, model, overlays, panelApi, providerSnapshot, settings])
  return <>
    <SampleLegend emptySeries={emptySeries}>
      {model.groups.map(({ definition, label, color }, groupIndex) => <div key={groupIndex}>
        {overlays && <strong><span className="sample-legend-key" aria-hidden="true" style={{ backgroundColor: settings.traces.get(definition.seriesId)?.color ?? color }} />{label} — </strong>}
        <span>{definition.level} / {definition.statistic} / {definition.unitLabel} / {definition.sampling}
          {definition.interval && ` (${definition.interval})`}{definition.position && ` / period ${definition.position} label`}
          {definition.frame && ` / frame: ${definition.frame}`}</span>
        {definition.axes.length > 1 && <div role="group" aria-label={overlays ? `Visible vector components for ${label}` : 'Visible vector components'}>{definition.axes.map(({ axis, meaning }, i) =>
          <label key={axis}><input type="checkbox" defaultChecked onChange={(event) => chartRef.current?.dispatchAction({
            type: event.target.checked ? 'legendSelect' : 'legendUnSelect', name: overlays ? `${groupIndex}:${axis}` : axis,
          })} /><span style={{ color: settings.traces.get(definition.seriesId)?.color ?? (overlays ? color : colors[i]) }}>{['●', '■', '▲'][i]}</span> {axis}: {meaning}</label>)}</div>}
      </div>)}
      {model.groups.some(({ definition, samples }) => usesPeriodBars(definition) && samples.some((sample) => sample.period)) &&
        <span>Bars span the recorded observation periods.</span>}
      {model.groups.some(({ definition, samples }) => definition.position && !usesPeriodBars(definition) && samples.some((sample) => sample.period)) &&
        <span>Segments show actual periods. Symbols on extremum segments mark known occurrences.</span>}
      {model.groups.some(({ definition, samples }) => definition.position && samples.length && samples.every((sample) => !sample.period)) &&
        <span>Points mark the period labels.</span>}
      {model.groups.some(({ samples }) => samples.some((sample) => sample.detectionBound !== null)) && <span>Hollow triangles show detection bounds, not measured values: ▼ below; ▲ above.</span>}
    </SampleLegend>
    {omissions && <p role="status">Some numbers cannot be plotted at safe numeric precision. Their exact values remain available in Time series data.</p>}
    <div className="sample-chart" style={model.units.length > 1 ? { minWidth: model.minWidth } : undefined}>
      <div ref={host} className="sample-chart-canvas" role="img" aria-label={chartLabel ?? (providerSnapshot ? 'Offline water-level chart'
        : 'Scientific time-series chart; exact data is available in the Data panel')} />
      {allowSampleClicks && <div ref={selectedLine} className="sample-chart-selected-time" aria-hidden="true"
        hidden style={{ top: grid.top, bottom: grid.bottom }}>
        {valueBoxes.map(({ trace, background, label, title }) => <span key={trace} className="sample-chart-value-box"
          title={title} style={{ backgroundColor: background, color: boxTextColor(background) }}>{label}</span>)}
      </div>}
      <div className="sample-chart-zoom" role="group" aria-label="Graph zoom"
        style={{ top: grid.top + zoomControlInset, left: model.left + zoomControlInset }}>
        <button type="button" className="sample-chart-zoom-in" aria-label="Zoom in" title="Zoom in"
          disabled={!canZoomIn} onClick={() => zoomBy(0.5)} />
        <button type="button" aria-label="Zoom out" title="Zoom out" disabled={!canZoomOut} onClick={() => zoomBy(2)} />
      </div>
      {model.groups.length > 0 && <button type="button" className="sample-chart-settings-button" aria-haspopup="dialog"
        style={{ top: grid.top + zoomControlInset, right: model.right + zoomControlInset }}
        title="Graph settings" aria-label="Graph settings" onClick={() => { setSettingsError(''); setEditingSettings(true) }}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6h16M4 12h16M4 18h16" /><path strokeWidth="4" d="M8 3v6m8 0v6m-6 0v6" />
        </svg>
      </button>}
    </div>
    {editingSettings && <dialog ref={settingsDialog} aria-labelledby={settingsTitle} className="sample-chart-settings"
      onClose={() => setEditingSettings(false)}>
      <form onSubmit={applySettings}>
        <h2 id={settingsTitle}>Graph settings</h2>
        <h3>Series appearance</h3>
        {model.groups.map(({ definition, label, color, samples }, index) => {
          const appearance = settings.traces.get(definition.seriesId)
          const hasLine = definition.position
            ? !usesPeriodBars(definition) && samples.some((sample) => sample.period)
            : definition.sampling === 'equidistant'
          return <fieldset key={definition.seriesId}>
            <legend>{label}</legend>
            <label>Color <input name={`color-${index}`} type="color" defaultValue={appearance?.color ?? (overlays ? color : colors[0])} /></label>
            {hasLine && <>
              <label>Line thickness (px) <input name={`width-${index}`} type="number" min="1" max="12" step="1"
                placeholder="Default" defaultValue={appearance?.width} /></label>
              <label>Line style <select name={`style-${index}`} defaultValue={appearance?.style ?? ''}>
                <option value="">Default</option><option value="solid">Solid</option>
                <option value="dashed">Dashed</option><option value="dotted">Dotted</option>
              </select></label>
            </>}
          </fieldset>
        })}
        <h3>Y-axis settings</h3>
        <p>Leave either bound blank for automatic scaling.</p>
        {model.units.map(({ key, name, position }, index) => <fieldset key={key}>
          <legend>Y-axis {index + 1} — {name} ({position})</legend>
          <label>Minimum <input name={`min-${index}`} type="number" step="any" placeholder="Auto" defaultValue={settings.axes.get(key)?.min} /></label>
          <label>Maximum <input name={`max-${index}`} type="number" step="any" placeholder="Auto" defaultValue={settings.axes.get(key)?.max} /></label>
          <label className="sample-axis-direction">
            <input name={`inverse-${index}`} type="checkbox" defaultChecked={settings.axes.get(key)?.inverse} />
            <span>Reverse direction</span>
          </label>
        </fieldset>)}
        {settingsError && <p role="alert">{settingsError}</p>}
        <div className="sample-chart-settings-actions">
          <button type="button" onClick={() => { setSettings(defaultSettings); settingsDialog.current?.close() }}>Restore defaults</button>
          <button type="button" onClick={() => settingsDialog.current?.close()}>Cancel</button>
          <button type="submit">Apply</button>
        </div>
      </form>
    </dialog>}
  </>
}
