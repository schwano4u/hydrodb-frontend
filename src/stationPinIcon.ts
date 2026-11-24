export const stationPinViewBox = '0 0 24 32'
export const stationPinPath = 'M12 0C5.4 0 0 5.4 0 12c0 8.4 12 20 12 20s12-11.6 12-20C24 5.4 18.6 0 12 0Z'
export const stationPinCenter = { cx: '12', cy: '12', r: '4.5' }

export function stationPinTitle(name: string, id: string, classification?: string, details: readonly string[] = []) {
  return [`Station: ${name}`, `Station ID: ${id}`,
    ...(classification === undefined ? [] : [`Classification: ${classification}`, ...details])].join('\n')
}
