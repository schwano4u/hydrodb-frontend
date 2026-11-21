import { useCallback, useState } from 'react'
import { useMetadataRead } from './useMetadataRead'
import { catalogPath, decodeNode, decodePage } from './metadata'
import type { Collection, MetadataClient, MetadataNode, Page, Selection } from './metadata'

const nodes = (body: unknown) => decodePage(body, decodeNode)
const empty: Selection = { filters: [], q: '', asOf: '' }
export type MetadataView = 'Filters' | 'Tree view' | 'By instance type'
export type TreeLabel = 'name' | 'id'
export type TreeNaming = Partial<Record<Collection, TreeLabel[]>>

export function useMetadataSelection(props: { client: MetadataClient; onExpired: () => void }, enabled = true) {
  const [selection, setSelection] = useState<Selection>(empty)
  const [cutoff, setCutoff] = useState<string>()
  const [collection, setCollection] = useState<Collection>('series')
  const [epoch, setEpoch] = useState(0)
  const [treeNaming, setTreeNaming] = useState<TreeNaming>({})
  const capture = useCallback((page: Page<MetadataNode>) => setCutoff(page.cutoff), [])
  const initial = useMetadataRead(enabled && !cutoff ? catalogPath(selection, collection, { after: '' }) : null,
    nodes, props.client, props.onExpired, capture)
  function refresh() {
    props.client.clear(); setCutoff(undefined); setEpoch((v) => v + 1)
    initial.retry()
  }
  return { selection, setSelection, cutoff, collection, setCollection, epoch, refresh, initial, treeNaming, setTreeNaming }
}
