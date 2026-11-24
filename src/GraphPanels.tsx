import { useEffect, useEffectEvent } from 'react'
import { createPortal } from 'react-dom'
import type { DockviewPanelApi } from 'dockview'
import SampleViewer from './SampleViewer'
import type { MetadataClient } from './metadata'
import { useSampleViewer } from './useSampleViewer'
import { graphPanels, panels } from './workspaceLayout'
import type { GraphId } from './workspaceLayout'
import type { GraphPeriod, GraphRequest } from './workspaceSelections'

export default function GraphPanels({ id, chart, chartPanelApi, table, tableInPopout, request, onPeriod, client, onExpired, openTable }: {
  id: GraphId; chart?: HTMLElement; table?: HTMLElement; tableInPopout?: boolean; request?: GraphRequest
  chartPanelApi?: DockviewPanelApi
  onPeriod: (period: GraphPeriod) => void
  client: MetadataClient; onExpired: () => void; openTable: () => void
}) {
  const viewer = useSampleViewer(client, onExpired, onPeriod)
  const select = useEffectEvent(() => {
    if (request) viewer.selectMany(request.selections, request.period, request.initialCutoff)
    else viewer.clear()
  })
  const selections = request?.selections
  useEffect(() => { select() }, [selections])
  return <>
    {chart && createPortal(<SampleViewer viewer={viewer} mode="chart" title={panels[id].title}
      panelApi={chartPanelApi} openSampleData={openTable} />, chart)}
    {table && createPortal(<SampleViewer viewer={viewer} mode="data" title={panels[graphPanels[id]].title}
      inPopout={tableInPopout} openSampleData={openTable} />, table)}
  </>
}
