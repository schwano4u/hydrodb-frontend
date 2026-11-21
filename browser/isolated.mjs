import { execFileSync, spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
if (args[0] !== '--inside') {
  const pid = execFileSync('docker', [
    'inspect', '--format', '{{.State.Pid}}', 'hydrodb-empty-test-ingress-1',
  ], { encoding: 'utf8' }).trim()
  if (!/^[1-9][0-9]*$/.test(pid)) throw new Error('Test ingress is not running.')
  const result = spawnSync('nsenter', [
    '--target', pid, '--net', process.execPath, fileURLToPath(import.meta.url), '--inside', ...args,
  ], { stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} else {
  const sockets = new Set()
  const server = net.createServer((client) => {
    const upstream = net.connect(8443, '127.0.0.1')
    for (const socket of [client, upstream]) {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', (error) => {
        // Aborted browser reads normally close the forwarded stream.
        if (!['EPIPE', 'ECONNRESET'].includes(error.code)) {
          console.error('Isolated test TCP forwarding failed:', error.code)
        }
        client.destroy()
        upstream.destroy()
      })
    }
    client.pipe(upstream)
    upstream.pipe(client)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(18443, '127.0.0.1', resolve)
  })
  try {
    const child = spawn(process.execPath, [
      'node_modules/@playwright/test/cli.js', 'test', ...args.slice(1),
    ], { stdio: 'inherit' })
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => resolve(code ?? 1))
    })
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  }
}
