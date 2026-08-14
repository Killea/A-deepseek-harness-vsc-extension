/**
 * ProjectionService (M4b): the extension-side per-session projection store
 * behind the composer todo plan strip, mirroring the dsh web client's
 * projection machinery (client/runtime sessions/projection-store.ts +
 * manager.ts higher-seq-wins): the history-tail projections block seeds the
 * store under its asOfSeq; live `session/projection` frames write under their
 * own seq; a write applies only when its seq is strictly greater than the
 * current watermark. Whole-value overwrites make this order-safe without a
 * buffer — unlike the sequential session-event fold, a frame arriving before
 * the attach seed can never corrupt state (the seed's asOfSeq is older and is
 * rejected).
 *
 * v1 exposes only the `todos` key (the plan strip); the store itself is
 * generic over keys so later milestones (goal/plan projections) add read
 * accessors without restructuring. Absent seed and frames = null = the plan
 * strip renders nothing (silent degradation, matching the dsh web GUI).
 */

import { EventEmitter } from 'node:events'
import type { ServerRequest } from '../dsh/wire.ts'
import type { PermissionSelectView, TodoItem } from '../shared/protocol.ts'

/** Structural mirror of the history-tail projections block (sessions.schema). */
export interface ProjectionsBlock {
  /** Seq of the last event the values reflect; -1 for an empty log. */
  asOfSeq: number
  /** Whole current value per registered projection key. */
  values: Record<string, unknown>
}

/** The mux projection frame this service consumes (others are ignored). */
type ProjectionFrame = {
  type: 'session/projection'
  sessionId: string
  key: string
  value: unknown
  seq: number
}

/** One per-session, per-key value slot: the value plus its write watermark. */
interface Slot {
  value: unknown
  seq: number
}

export class ProjectionService extends EventEmitter {
  private readonly slots = new Map<string, Map<string, Slot>>()

  /** Seed the store from a history-tail projections block (attach path). */
  seed(sessionId: string, block: ProjectionsBlock): void {
    for (const [key, value] of Object.entries(block.values)) {
      this.setIfNewer(sessionId, key, value, block.asOfSeq)
    }
  }

  /** Route one mux frame: `session/projection` writes under its own seq. */
  applyFrame(frame: ServerRequest): void {
    const payload = frame.payload as ProjectionFrame
    if (payload.type !== 'session/projection') return
    this.setIfNewer(payload.sessionId, payload.key, payload.value, payload.seq)
  }

  /** The session's current todo list, or null when no value is known (v1 key). */
  todosOf(sessionId: string): TodoItem[] | null {
    const value = this.slots.get(sessionId)?.get('todos')?.value
    if (value === undefined || value === null) return null
    return value as TodoItem[]
  }

  /** The session's current permission select (permissions 投影), or null when unknown. */
  permissionsOf(sessionId: string): PermissionSelectView | null {
    const value = this.slots.get(sessionId)?.get('permissions')?.value
    if (value === undefined || value === null) return null
    return value as PermissionSelectView
  }

  /** Drop the projection state of one session (session deletion / detach). */
  clear(sessionId: string): void {
    this.slots.delete(sessionId)
  }

  /** Strictly-greater-seq wins; emits change (sessionId, key) only when a slot moved. */
  private setIfNewer(sessionId: string, key: string, value: unknown, seq: number): void {
    const keys = this.slots.get(sessionId) ?? new Map<string, Slot>()
    const current = keys.get(key)
    if (current && seq <= current.seq) return
    keys.set(key, { value, seq })
    this.slots.set(sessionId, keys)
    this.emit('change', sessionId, key)
  }
}
