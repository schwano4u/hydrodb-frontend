import { useEffect, useState } from 'react'
import StationMap from './StationMap'
import { useMetadataSelection } from './useMetadataSelection'
import { MetadataClient } from './metadata'
import type { DetailSelection, SelectedSeries, Selection } from './metadata'
import type { MapClassificationSnapshot } from './stationClassification'
import type { DockviewPanelApi } from 'dockview'

export type MapCopySeed = { selection: Selection; cutoff?: string; classification?: MapClassificationSnapshot }

export default function IndependentMap({ seed, onExpired, onOpen, onOpenSeries, panelApi }: {
  seed: MapCopySeed; onExpired: () => void; onOpen: (selection: DetailSelection) => void; panelApi?: DockviewPanelApi
  onOpenSeries: (series: SelectedSeries[], cutoff: string) => void
}) {
  const [client] = useState(() => new MetadataClient())
  const state = useMetadataSelection({ client, onExpired }, true, seed)
  useEffect(() => () => client.clear(), [client])
  return <StationMap state={state} client={client} onExpired={onExpired} onOpen={onOpen} onOpenSeries={onOpenSeries}
    lockedSelection initialClassification={seed.classification} panelApi={panelApi} />
}
