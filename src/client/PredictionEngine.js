import { ReconciliationEngine } from './ReconciliationEngine.js'
import { applyMovement, DEFAULT_MOVEMENT } from '../shared/movement.js'
import { createKalmanFilterX, createKalmanFilterY, createKalmanFilterZ,
         createKalmanFilterVelX, createKalmanFilterVelY, createKalmanFilterVelZ,
         createKalmanFilterRotation } from '../util/KalmanFilterFactory.js'

export class PredictionEngine {
  constructor(tickRate = 60, kalmanConfig = {}) {
    this.tickRate = tickRate
    this.tickDuration = 1000 / tickRate
    this.localPlayerId = null
    this.localState = null
    this.lastServerState = null
    this.inputHistory = []
    this.reconciliationEngine = new ReconciliationEngine()
    this.movement = { ...DEFAULT_MOVEMENT }
    this.gravityY = -9.81

    const cfg = kalmanConfig || {}
    this.kalmanFilters = {
      posX: createKalmanFilterX(cfg.posQ, cfg.posR),
      posY: createKalmanFilterY(cfg.posQY, cfg.posR),
      posZ: createKalmanFilterZ(cfg.posQ, cfg.posR),
      velX: createKalmanFilterVelX(cfg.velQ, cfg.velR),
      velY: createKalmanFilterVelY(cfg.velQY, cfg.velR),
      velZ: createKalmanFilterVelZ(cfg.velQ, cfg.velR),
      rotation: createKalmanFilterRotation(cfg.rotQ, cfg.rotR)
    }
  }

  setMovement(m) { Object.assign(this.movement, m) }

  setGravity(g) { if (g && g[1] != null) this.gravityY = g[1] }

  resetKalmanFilters() {
    this.kalmanFilters.posX.reset(0, 0)
    this.kalmanFilters.posY.reset(0, 0)
    this.kalmanFilters.posZ.reset(0, 0)
    this.kalmanFilters.velX.reset(0, 0)
    this.kalmanFilters.velY.reset(0, 0)
    this.kalmanFilters.velZ.reset(0, 0)
    this.kalmanFilters.rotation.reset([0, 0, 0, 1], [0, 0, 0])
  }

  setKalmanNoise(axis, Q, R) {
    if (!this.kalmanFilters[axis]) return
    this.kalmanFilters[axis].Q = Q
    this.kalmanFilters[axis].R = R
  }

  init(playerId, initialState = {}) {
    this.localPlayerId = playerId
    this.localState = {
      id: playerId,
      position: initialState.position || [0, 0, 0],
      rotation: initialState.rotation || [0, 0, 0, 1],
      velocity: initialState.velocity || [0, 0, 0],
      onGround: true,
      health: initialState.health || 100
    }
    this.lastServerState = JSON.parse(JSON.stringify(this.localState))
  }

  addInput(input) {
    this.inputHistory.push({
      sequence: this.inputHistory.length,
      data: input,
      timestamp: Date.now()
    })
    if (this.inputHistory.length > 60) {
      this.inputHistory.shift()
    }
    this.predict(input)
  }

  predict(input) {
    const dt = this.tickDuration / 1000
    const state = this.localState
    applyMovement(state, input, this.movement, dt)
    state.velocity[1] += this.gravityY * dt
    state.position[0] += state.velocity[0] * dt
    state.position[1] += state.velocity[1] * dt
    state.position[2] += state.velocity[2] * dt
    if (state.position[1] < 0) {
      state.position[1] = 0
      state.velocity[1] = 0
      state.onGround = true
    }
  }

  onServerSnapshot(snapshot, tick) {
    for (const serverPlayer of snapshot.players) {
      if (serverPlayer.id === this.localPlayerId) {
        this.lastServerState = JSON.parse(JSON.stringify(serverPlayer))

        // W3-011: Feed to Kalman filters
        const pos = [serverPlayer.position?.[0] ?? serverPlayer.px, serverPlayer.position?.[1] ?? serverPlayer.py, serverPlayer.position?.[2] ?? serverPlayer.pz]
        const vel = [serverPlayer.velocity?.[0] ?? serverPlayer.vx, serverPlayer.velocity?.[1] ?? serverPlayer.vy, serverPlayer.velocity?.[2] ?? serverPlayer.vz]
        const rot = serverPlayer.rotation || [0, 0, 0, 1]

        this.kalmanFilters.posX.update(pos[0])
        this.kalmanFilters.posY.update(pos[1])
        this.kalmanFilters.posZ.update(pos[2])
        this.kalmanFilters.velX.update(vel[0])
        this.kalmanFilters.velY.update(vel[1])
        this.kalmanFilters.velZ.update(vel[2])
        this.kalmanFilters.rotation.update(rot)

        const reconciliation = this.reconciliationEngine.reconcile(
          this.lastServerState, this.localState, tick
        )
        if (reconciliation.needsCorrection) {
          this.reconciliationEngine.applyCorrection(this.localState, reconciliation.correction)

          // W3-018: Reset Kalman filters on major divergence to prevent filter lag
          if (reconciliation.isMajor) {
            this.kalmanFilters.posX.reset(pos[0], vel[0])
            this.kalmanFilters.posY.reset(pos[1], vel[1])
            this.kalmanFilters.posZ.reset(pos[2], vel[2])
            this.kalmanFilters.velX.reset(vel[0], 0)
            this.kalmanFilters.velY.reset(vel[1], 0)
            this.kalmanFilters.velZ.reset(vel[2], 0)
            this.kalmanFilters.rotation.reset(rot, [0, 0, 0])
          }

          this.resimulate()
        }
      }
    }
  }

  resimulate() {
    const baseState = JSON.parse(JSON.stringify(this.lastServerState))
    this.localState = baseState
    for (const input of this.inputHistory) {
      this.predict(input.data)
    }
  }

  getDisplayState(tick, ticksSinceLastSnapshot) {
    // W3-012: Replace velocity extrapolation with Kalman predict
    const dt = this.tickDuration / 1000

    this.kalmanFilters.posX.predict(dt)
    this.kalmanFilters.posY.predict(dt)
    this.kalmanFilters.posZ.predict(dt)
    this.kalmanFilters.velX.predict(dt)
    this.kalmanFilters.velY.predict(dt)
    this.kalmanFilters.velZ.predict(dt)
    this.kalmanFilters.rotation.predict(dt)

    // W3-013: Integrate rotation Kalman
    const posState = {
      x: this.kalmanFilters.posX.getState().position,
      y: this.kalmanFilters.posY.getState().position,
      z: this.kalmanFilters.posZ.getState().position
    }

    const rotState = this.kalmanFilters.rotation.getState()

    return {
      id: this.localState.id,
      position: [posState.x, posState.y, posState.z],
      rotation: rotState.q,
      angularVel: rotState.angularVel,
      velocity: [
        this.kalmanFilters.velX.getState().position,
        this.kalmanFilters.velY.getState().position,
        this.kalmanFilters.velZ.getState().position
      ],
      health: this.localState.health,
      onGround: this.localState.onGround,
      lookPitch: this.localState.lookPitch,
      lookYaw: this.localState.lookYaw,
      crouch: this.localState.crouch,
      _aiming: this.localState._aiming
    }
  }

  getInputHistory() { return this.inputHistory }

  calculateDivergence() {
    if (!this.lastServerState || !this.localState) return 0
    const dx = this.localState.position[0] - this.lastServerState.position[0]
    const dy = this.localState.position[1] - this.lastServerState.position[1]
    const dz = this.localState.position[2] - this.lastServerState.position[2]
    return Math.sqrt(dx * dx + dy * dy + dz * dz)
  }
}
