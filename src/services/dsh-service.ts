/**
 * DshService: owns the end-to-end dsh runtime for one VS Code window
 * (D4/D9): discover -> spawn `dsh web --port 0` -> wire client + event
 * downlinks -> status to subscribers. One instance per extension activation;
 * window close stops the child via SIGTERM (route §6).
 */

import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import { discoverDsh, type DshLauncher } from '../dsh/discovery.ts'
import { startDshWeb, type StartedDshServer } from '../dsh/server.ts'
import { WireClient, EventStream, type EnvelopeValidator, type ServerRequest } from '../dsh/wire.ts'
import { createWireValidator } from '../dsh/schemas.ts'

export type DshStatus = 'discovering' | 'starting' | 'ready' | 'reconnecting' | 'stopped' | 'error'

export interface DshServiceOptions {
  minimumVersion: string
  explicitPath?: string | null
  onStatus?: (status: DshStatus, detail?: string) => void
  onLog?: (line: string) => void
}

export class DshService extends EventEmitter {
  private readonly options: DshServiceOptions
  private launcher: DshLauncher | null = null
  private server: StartedDshServer | null = null
  private wire: WireClient | null = null
  private validator: EnvelopeValidator | null = null
  private mux: EventStream | null = null
  private host: EventStream | null = null
  private started = false
  private stopping = false
  private status: DshStatus = 'stopped'
  /** 当前生效的显式 launcher 路径（M6：设置面板引导页改 dshPath 后经 restart 更新）。 */
  private explicitPath: string | null | undefined

  constructor(options: DshServiceOptions) {
    super()
    this.options = options
    this.explicitPath = options.explicitPath
  }

  get statusValue(): DshStatus {
    return this.status
  }

  get baseUrl(): string | null {
    return this.server?.baseUrl ?? null
  }

  get client(): WireClient | null {
    return this.wire
  }

  get launcherValue(): DshLauncher | null {
    return this.launcher
  }

  /**
   * 重启 dsh 运行时（M6 设置面板引导页）：先 stop 再用（可能更新的）显式
   * launcher 路径重新 discovery + spawn。start() 的 once 语义由 stop() 复位。
   * @param explicitPath - 新的 `weinibuliu.dsh-vsc.dshPath`；省略则沿用当前值。
   */
  async restart(explicitPath?: string | null): Promise<void> {
    await this.stop()
    this.explicitPath = explicitPath
    await this.start()
  }

  private setStatus(status: DshStatus, detail?: string): void {
    this.status = status
    this.options.onStatus?.(status, detail)
    this.emit('status', status, detail)
  }

  /** Discover + spawn + connect wire + open event streams. Idempotent. */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.stopping = false
    try {
      this.setStatus('discovering')
      this.launcher = await discoverDsh({
        minimumVersion: this.options.minimumVersion,
        explicitPath: this.explicitPath,
      })
      this.options.onLog?.(`dsh ${this.launcher.version} @ ${this.launcher.command} (${this.launcher.source})`)

      this.setStatus('starting')
      this.server = await startDshWeb({ launcher: this.launcher, onStderr: (line) => this.options.onLog?.(`[dsh] ${line}`) })
      this.options.onLog?.(`dsh web ready: ${this.server.baseUrl}`)

      this.validator = await createWireValidator(this.launcher)
      this.wire = new WireClient(this.server.baseUrl, this.validator ?? undefined)

      // Event downlinks (§3). Frame dispatch lands on consumers via events.
      const base = this.server.baseUrl.replace(/^http:/u, 'ws:')
      this.mux = new EventStream({ url: `${base}/api/events.mux`, validator: this.validator ?? undefined }, WebSocket)
      this.host = new EventStream({ url: `${base}/api/events.host`, validator: this.validator ?? undefined }, WebSocket)
      this.mux.on('frame', (frame: ServerRequest) => this.emit('mux', frame))
      this.host.on('frame', (frame: ServerRequest) => this.emit('host', frame))
      this.mux.on('error', (error: Error) => this.options.onLog?.(`[events.mux] ${error.message}`))
      this.host.on('error', (error: Error) => this.options.onLog?.(`[events.host] ${error.message}`))
      // Reconnect signal for conversation resync (M2): the stream drops and
      // auto-reopens; events emitted while it was down are refetched via
      // session.history. Not emitted during a deliberate stop().
      this.mux.on('close', () => {
        if (!this.stopping) this.emit('muxClose')
      })
      // M4 重连状态: mux 掉线（非主动 stop）→ reconnecting；重连成功 → 回 ready。
      // HTTP RPC 与 respond 与 WS 下行无关，pending 卡片在 reconnecting 期间仍可应答。
      this.mux.on('close', () => {
        if (!this.stopping && this.status === 'ready') this.setStatus('reconnecting')
      })
      this.mux.on('open', () => {
        if (this.status === 'reconnecting') this.setStatus('ready')
      })
      this.mux.start()
      this.host.start()

      this.setStatus('ready')
    } catch (error) {
      this.started = false
      this.setStatus('error', error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  /** Stop the child (SIGTERM grace) and tear down event streams. */
  async stop(): Promise<void> {
    this.stopping = true
    this.mux?.stop()
    this.host?.stop()
    this.mux = null
    this.host = null
    const server = this.server
    this.server = null
    this.wire = null
    this.started = false
    if (server) {
      const code = await server.stop()
      this.options.onLog?.(`dsh web 已退出 (code=${String(code)})`)
    }
    this.setStatus('stopped')
  }
}
