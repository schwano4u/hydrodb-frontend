import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  catalogPath, decodeNode, decodePage, entities, format, identity, isCollection, isJson, label, name, nodeVersion, object, version,
} from './metadata'
import type { Collection, DetailSelection, Json, MetadataClient, MetadataNode, Reference, Selection } from './metadata'
import { NodeLink } from './MetadataBrowser'
import { useMetadataRead } from './useMetadataRead'
import { ApiError, timestamp } from './api'
import type { MetadataPath } from './api'

const nodes = (body: unknown) => decodePage(body, decodeNode)
const revisions = (body: unknown) => decodePage(body, (item) => {
  if (!object(item)) throw new ApiError('malformed', 'Invalid retained revision.')
  return item
})
const context = (body: unknown): { content: Json; links: Reference[] } => {
  if (!object(body) || !object(body.scientific_context) || !isJson(body.scientific_context) || typeof body.read_cutoff !== 'string') {
    throw new ApiError('malformed', 'Invalid scientific context.')
  }
  const content = body.scientific_context
  const links: Reference[] = []
  if (object(content.processing) && Array.isArray(content.processing.inputs)) {
    for (const input of content.processing.inputs) {
      if (!object(input) || typeof input.series_id !== 'string') throw new ApiError('malformed', 'Invalid pinned lineage input.')
      links.push({ collection: 'series', id: input.series_id, field: 'processing input', version: version(input.series_metadata_version) })
    }
  }
  if (object(content.measurement) && object(content.measurement.reference)) {
    const ref = content.measurement.reference
    if (typeof ref.unit_id !== 'string') throw new ApiError('malformed', 'Invalid measurement reference Unit.')
    links.push({ collection: 'units', id: ref.unit_id, field: 'measurement reference Unit', version: version(ref.unit_metadata_version) })
  }
  return { content, links }
}
type Props = {
  selection: DetailSelection; client: MetadataClient; onExpired: () => void
  onOpen: (selection: DetailSelection) => void
}

function decodeCoverage(body: unknown) {
  if (!object(body) || typeof body.series_id !== 'string') {
    throw new ApiError('malformed', 'Invalid Series coverage.')
  }
  const first = body.first_sample_at
  const last = body.last_sample_at
  if (first === null && last === null) return { id: body.series_id, first, last }
  if (!timestamp(first) || !timestamp(last) || Date.parse(first) > Date.parse(last)) {
    throw new ApiError('malformed', 'Invalid Series coverage bounds.')
  }
  return { id: body.series_id, first, last }
}

function Coverage({ selection, client, onExpired }: Props) {
  const path: MetadataPath = `/api/v1/series/${encodeURIComponent(selection.id)}/coverage?${new URLSearchParams({ read_cutoff: selection.cutoff })}`
  const result = useMetadataRead(path, decodeCoverage, client, onExpired)
  const bounds = result.data
  const error = result.error ?? (bounds && bounds.id !== selection.id ? 'The API returned coverage for a different series.' : null)
  return <section aria-label="Series data span">
    <h6>Data span</h6>
    {result.loading && <p role="status">Loading sample span...</p>}
    {error && <p role="alert">{error} <button type="button" onClick={result.retry}>Retry coverage</button></p>}
    {!error && bounds && (bounds.first && bounds.last
      ? <>
        <dl className="metadata-fields">
          <div><dt>First sample (UTC)</dt><dd><time dateTime={bounds.first}>{bounds.first}</time></dd></div>
          <div><dt>Last sample (UTC)</dt><dd><time dateTime={bounds.last}>{bounds.last}</time></dd></div>
        </dl>
        <p>Sample timestamps across all Series versions. The span can contain gaps and missing values.</p>
      </>
      : <p>No sample records at this read cutoff.</p>)}
  </section>
}

function Retained({ node, selection, client, onExpired, onOpen }: Props & { node: MetadataNode }) {
  const [after, setAfter] = useState('')
  const path: MetadataPath = `/api/v1/metadata/${node.collection}/${encodeURIComponent(identity(node))}/revisions?${new URLSearchParams({ limit: '25', after: after || '0', read_cutoff: selection.cutoff })}`
  const result = useMetadataRead(path, revisions, client, onExpired)
  const field = `${entities[node.collection].prefix}_metadata_version`
  return <section aria-label="Retained revisions">
    {result.loading && <p role="status">Loading retained revisions...</p>}
    {result.error && <p role="alert">{result.error}<button type="button" onClick={result.retry}>Retry revisions</button></p>}
    {result.data && <>
      <ul>{result.data.items.map((item) => <li key={version(item[field])}>
        <button type="button" onClick={() => onOpen({ ...selection, version: version(item[field]) })}>Open retained version {version(item[field])}</button>
        {' / '}{String(item[`${entities[node.collection].prefix}_validity_start`])}
      </li>)}</ul>
      <p>{result.data.next ? 'Partial revision history: more remain.' : 'End of accessible retained revisions.'}</p>
      <button type="button" onClick={() => setAfter('')}>First revisions</button>
      <button type="button" disabled={!result.data.next} onClick={() => setAfter(result.data?.next ?? '')}>Next revisions</button>
    </>}
  </section>
}

function Related({ node, selection, client, onExpired, onOpen }: Props & { node: MetadataNode }) {
  const [collection, setCollection] = useState<Collection>(node.collection === 'parameter_groups' ? 'parameters' : node.collection === 'instruments' ? 'instrument_deployments' : 'series')
  const [after, setAfter] = useState('')
  const prefix = entities[node.collection].prefix
  const related: Selection = { q: '', asOf: selection.asOf, filters: [
    { collection: node.collection, field: `${prefix}_id`, values: [identity(node)] },
    { collection: node.collection, field: `${prefix}_metadata_version`, values: [nodeVersion(node)] },
  ] }
  const result = useMetadataRead(catalogPath(related, collection, { after }, selection.cutoff), nodes, client, onExpired)
  return <section aria-label="Related instances">
    <label htmlFor="metadata-related-type">Related instance type</label><select id="metadata-related-type" value={collection} onChange={(event) => {
      if (isCollection(event.target.value)) { setCollection(event.target.value); setAfter('') }
    }}>{(['series', 'parameters', 'instrument_deployments'] as const).map((c) => <option key={c} value={c}>{entities[c].title}</option>)}</select>
    <p>Related by this exact retained ID/version at the same cutoff; no latest-definition substitution.</p>
    {result.loading && <p role="status">Loading related instances...</p>}
    {result.error && <p role="alert">{result.error}<button type="button" onClick={result.retry}>Retry related instances</button></p>}
    {result.data && <>
      {!result.data.items.length && <p>No related authorized instances for this version.</p>}
      <ul>{result.data.items.map((related) => <li key={identity(related)}><NodeLink node={related} open={(ref) => onOpen({ ...ref, cutoff: selection.cutoff, asOf: selection.asOf })} /></li>)}</ul>
      <p>{result.data.next ? 'Partial results: more remain.' : 'End of matching related instances.'}</p>
      <button type="button" onClick={() => setAfter('')}>First related page</button>
      <button type="button" disabled={!result.data.next} onClick={() => setAfter(result.data?.next ?? '')}>Next related page</button>
    </>}
  </section>
}

function Scientific({ node, selection, client, onExpired, onOpen }: Props & { node: MetadataNode }) {
  const path: MetadataPath = `/api/v1/metadata/series/${encodeURIComponent(identity(node))}/scientific_context?${new URLSearchParams({ version: nodeVersion(node), read_cutoff: selection.cutoff })}`
  const result = useMetadataRead(path, context, client, onExpired)
  return <>
    {result.loading && <p role="status">Loading pinned scientific context...</p>}
    {result.error && <p role="alert">{result.error}<button type="button" onClick={result.retry}>Retry scientific context</button></p>}
    {result.data && <>
      <pre>{format(result.data.content)}</pre>
      <ul>{result.data.links.map((ref) => <li key={`${ref.field}:${ref.id}:${ref.version}`}>
        <button type="button" className="metadata-link" onClick={() => onOpen({ ...ref, cutoff: selection.cutoff, asOf: selection.asOf })}>
          {ref.field}: {ref.id} / retained version {ref.version}
        </button>
      </li>)}</ul>
    </>}
  </>
}

function LazySection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}><summary>{title}</summary>{open && children}</details>
}

export default function MetadataDetail(props: Props) {
  const { selection, client, onExpired, onOpen } = props
  const query: Selection = { filters: [], q: '', asOf: selection.asOf }
  const result = useMetadataRead(catalogPath(query, selection.collection, { mode: 'detail', id: selection.id, version: selection.version }, selection.cutoff), nodes, client, onExpired)
  const node = result.data?.items[0]
  const open = (ref: Reference) => onOpen({ ...ref, cutoff: selection.cutoff, asOf: selection.asOf })
  return <article className="metadata-panel" aria-label="Metadata detail">
    <h4>Read-only metadata detail</h4>
    <p className="metadata-id">Requested {selection.collection} / {selection.id} / version {selection.version}</p>
    {result.loading && <p role="status">Loading metadata detail...</p>}
    {result.error && <p role="alert">{result.error}<button type="button" onClick={result.retry}>Retry detail</button></p>}
    {node && <>
      <h5>{name(node)}</h5>
      <p>{node.status} / identified retained version {nodeVersion(node)}</p>
      {node.collection === 'series' && <Coverage {...props} />}
      {node.collection === 'stations' && <p>{!selection.asOf && node.position_scope === 'current_only'
        ? 'Current coordinates only. These coordinates do not describe an earlier observation or cutoff.'
        : 'Historical coordinates unavailable. No current coordinates have been substituted.'}</p>}
      {node.collection === 'instrument_deployments' && <p>Unspecified installation bounds are unknown/open, not inferred observation coverage.</p>}
      <dl className="metadata-fields">{Object.entries(node.item)
        .filter(([field]) => !(selection.asOf && node.collection === 'stations' && field.startsWith('station_location')))
        .map(([field, value]) => <div key={field}>
        <dt>{label(field)}</dt><dd>
          {node.references.some((ref) => ref.field === field)
            ? node.references.filter((ref) => ref.field === field).map((ref) => <button key={`${ref.id}:${ref.version}`} type="button" className="metadata-link" onClick={() => open(ref)}>{ref.id} / retained version {ref.version}</button>)
            : value !== null && typeof value === 'object'
              ? <details><summary>{label(field)} / structured data</summary><pre>{format(value)}</pre></details>
              : format(value)}
        </dd>
      </div>)}</dl>
      <LazySection title="Retained revisions"><Retained key={`${node.collection}:${identity(node)}`} {...props} node={node} /></LazySection>
      <LazySection title="Related instances"><Related key={`${node.collection}:${identity(node)}:${nodeVersion(node)}`} {...props} node={node} /></LazySection>
      {node.collection === 'series' && <LazySection title="Scientific context and lineage"><Scientific {...props} node={node} /></LazySection>}
    </>}
    <details><summary>Detail read context</summary>
      <p>{selection.asOf ? `Requested as-of UTC: ${selection.asOf}` : 'Captured current view'}</p>
      <p className="metadata-id">Resolved read cutoff: {selection.cutoff}</p>
      <p>Revision start fields are recording timestamps, not scientific validity or commit boundaries.</p>
    </details>
  </article>
}
