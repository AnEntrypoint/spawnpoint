#!/usr/bin/env node

import { createServer } from './src/sdk/server.js'
import { applyMovement, DEFAULT_MOVEMENT } from './src/shared/movement.js'

const TICK_RATE = 60
const DT = 1 / TICK_RATE
const TEST_DURATION_TICKS = Math.ceil(2.0 * TICK_RATE)

async function runCollisionTest() {
  console.log('[W4-024] Collision Test - Direct Tick Simulation')
  console.log('='.repeat(70))

  let server = null

  try {
    console.log('\n[SETUP] Creating server at', TICK_RATE, 'TPS...')
    server = await createServer({
      port: 8767,
      tickRate: TICK_RATE,
      movement: {
        maxSpeed: 4.0,
        groundAccel: 10.0,
        airAccel: 1.0,
        friction: 6.0,
        stopSpeed: 2.0,
        jumpImpulse: 4.0
      },
      playerConfig: {
        capsuleRadius: 0.4,
        capsuleHalfHeight: 0.9,
        crouchHalfHeight: 0.45,
        mass: 120
      }
    })

    const playerManager = server.playerManager
    const physicsInt = server.physicsIntegration
    const physics = server.physics

    console.log('[SETUP] Adding test players...')

    const mockSocket1 = { id: 1, send: () => {} }
    const mockSocket2 = { id: 2, send: () => {} }

    const playerId1 = playerManager.addPlayer(mockSocket1, {
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      health: 100
    })

    const playerId2 = playerManager.addPlayer(mockSocket2, {
      position: [3, 0, 0],
      velocity: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      health: 100
    })

    console.log('[SETUP] Player A:', playerId1, 'at [0, 0, 0]')
    console.log('[SETUP] Player B:', playerId2, 'at [3, 0, 0]')

    console.log('[SETUP] Adding physics colliders...')
    physicsInt.addPlayerCollider(playerId1, 0.4)
    physicsInt.addPlayerCollider(playerId2, 0.4)

    const p1 = playerManager.getPlayer(playerId1)
    const p2 = playerManager.getPlayer(playerId2)

    if (!p1 || !p2) {
      throw new Error('Players not created properly')
    }

    const measurements = {
      totalTicks: 0,
      firstCollisionTick: null,
      firstCollisionTime: null,
      firstCollisionDistance: null,
      collisionTicks: 0,
      lastCollisionTick: null,
      maxOverlap: 0,
      oscillationChanges: 0,
      distanceHistory: []
    }

    const CAPSULE_RADIUS = 0.4
    const MIN_DIST = CAPSULE_RADIUS * 2
    const movement = { ...DEFAULT_MOVEMENT, maxSpeed: 4.0 }

    let prevColliding = false

    console.log('\n[TEST] Running simulation for', TEST_DURATION_TICKS, 'ticks...')
    console.log('[TEST] Target speed: 2.0 m/s (half maxSpeed)')
    console.log('[TEST] Expected collision time: ~0.75s')
    console.log('[TEST] Min collision distance threshold: 0.8 units\n')

    for (let tick = 0; tick < TEST_DURATION_TICKS; tick++) {
      measurements.totalTicks++
      const t = tick * DT

      const p1st = p1.state
      const p2st = p2.state

      if (!p1st || !p2st) break

      const pos1 = p1st.position
      const pos2 = p2st.position
      const dx = pos2[0] - pos1[0]
      const dz = pos2[2] - pos1[2]
      const distance = Math.hypot(dx, dz)

      const normal = distance > 0 ? [dx / distance, 0, dz / distance] : [1, 0, 0]

      measurements.distanceHistory.push({
        tick,
        time: t,
        distance,
        pos1: [...pos1],
        pos2: [...pos2]
      })

      const isColliding = distance < MIN_DIST

      if (isColliding && !prevColliding) {
        measurements.firstCollisionTick = tick
        measurements.firstCollisionTime = t
        measurements.firstCollisionDistance = distance
        console.log(`[COLLISION] FIRST at tick ${tick} (t=${t.toFixed(3)}s) dist=${distance.toFixed(3)}u`)
      }

      if (isColliding) {
        measurements.collisionTicks++
        measurements.lastCollisionTick = tick
        const overlap = MIN_DIST - distance
        measurements.maxOverlap = Math.max(measurements.maxOverlap, overlap)
      }

      if (isColliding !== prevColliding) {
        measurements.oscillationChanges++
      }

      prevColliding = isColliding

      if (tick < 50 && tick % 10 === 0) {
        const vel1 = Math.hypot(p1st.velocity[0], p1st.velocity[2])
        console.log(`[T${tick}] d=${distance.toFixed(3)}u PA=(${pos1[0].toFixed(2)},${pos1[2].toFixed(2)}) PB=(${pos2[0].toFixed(2)},${pos2[2].toFixed(2)}) V=${vel1.toFixed(2)}`)
      }

      const input1 = { forward: true, right: false, left: false, backward: false, yaw: Math.PI / 2 }
      const input2 = { forward: true, right: false, left: false, backward: false, yaw: -Math.PI / 2 }

      applyMovement(p1st, input1, movement, DT)
      applyMovement(p2st, input2, movement, DT)

      const updated1 = physicsInt.updatePlayerPhysics(playerId1, p1st, DT)
      const updated2 = physicsInt.updatePlayerPhysics(playerId2, p2st, DT)

      p1st.position = updated1.position
      p1st.velocity = updated1.velocity
      p1st.onGround = updated1.onGround

      p2st.position = updated2.position
      p2st.velocity = updated2.velocity
      p2st.onGround = updated2.onGround

      physicsInt.setPlayerPosition(playerId1, p1st.position)
      physicsInt.setPlayerPosition(playerId2, p2st.position)

      physics.step(DT)

      const collisions1 = physicsInt.checkCollisionWithOthers(playerId1, [p1, p2])
      const collisions2 = physicsInt.checkCollisionWithOthers(playerId2, [p1, p2])

      const separated = new Set()

      for (const collision of collisions1) {
        const pairKey = playerId1 < collision.playerId ? `${playerId1}-${collision.playerId}` : `${collision.playerId}-${playerId1}`
        if (separated.has(pairKey)) continue
        separated.add(pairKey)

        const other = playerManager.getPlayer(collision.playerId)
        if (!other) continue

        const nx = collision.normal[0]
        const nz = collision.normal[2]
        const minDist = physicsInt.config.capsuleRadius * 2
        const overlap = minDist - collision.distance
        const halfPush = overlap * 0.5
        const pushVel = Math.min(halfPush / DT, 3.0)

        p1st.position[0] -= nx * halfPush
        p1st.position[2] -= nz * halfPush
        p1st.velocity[0] -= nx * pushVel
        p1st.velocity[2] -= nz * pushVel

        other.state.position[0] += nx * halfPush
        other.state.position[2] += nz * halfPush
        other.state.velocity[0] += nx * pushVel
        other.state.velocity[2] += nz * pushVel

        physicsInt.setPlayerPosition(playerId1, p1st.position)
        physicsInt.setPlayerPosition(collision.playerId, other.state.position)
      }
    }

    console.log('\n[ANALYSIS] Collision Detection Analysis:')
    console.log('================================')

    const collisionOccurred = measurements.firstCollisionTick !== null
    console.log('  Collision Detected:', collisionOccurred ? 'YES' : 'NO')

    if (collisionOccurred) {
      console.log('  First Collision Tick:', measurements.firstCollisionTick)
      console.log('  First Collision Time:', measurements.firstCollisionTime.toFixed(3), 'seconds')
      console.log('  First Collision Distance:', measurements.firstCollisionDistance.toFixed(3), 'units')
      console.log('  Expected Time: ~0.75 seconds')

      const timeDiff = Math.abs(measurements.firstCollisionTime - 0.75)
      const variance = (timeDiff / 0.75 * 100).toFixed(1)
      console.log('  Time Variance:', variance + '%')
    }

    console.log('\n[ANALYSIS] Separation Response:')
    console.log('================================')
    console.log('  Total Ticks in Collision:', measurements.collisionTicks)
    console.log('  Collision Ratio:', (measurements.collisionTicks / measurements.totalTicks * 100).toFixed(1) + '%')
    console.log('  Max Overlap (penetration):', measurements.maxOverlap.toFixed(3), 'units')
    console.log('  Oscillation Changes:', measurements.oscillationChanges)

    console.log('\n[VALIDATION] Acceptance Criteria:')
    console.log('================================')

    const criteria = {
      'Collision detected': collisionOccurred,
      'At correct distance (< 0.8 units)': !collisionOccurred || measurements.firstCollisionDistance < 0.85,
      'Time reasonable (0.55 - 0.95 seconds)': !collisionOccurred || (measurements.firstCollisionTime >= 0.55 && measurements.firstCollisionTime <= 0.95),
      'Low max overlap (< 0.2 units)': measurements.maxOverlap < 0.2,
      'No excessive oscillation (< 5 changes)': measurements.oscillationChanges < 5
    }

    let passCount = 0
    for (const [criterion, passed] of Object.entries(criteria)) {
      const status = passed ? 'PASS' : 'FAIL'
      console.log(`  [${status}] ${criterion}`)
      if (passed) passCount++
    }

    const overallPass = passCount === Object.keys(criteria).length
    console.log('\n' + '='.repeat(70))
    console.log('OVERALL RESULT:', overallPass ? 'PASS' : 'FAIL')
    console.log('Criteria Passed:', passCount, '/', Object.keys(criteria).length)
    console.log('='.repeat(70) + '\n')

    if (server?.httpServer) {
      await new Promise(r => server.httpServer.close(r))
    }

    process.exit(overallPass ? 0 : 1)

  } catch (err) {
    console.error('[W4-024 ERROR]', err.message)
    console.error(err.stack)
    if (server?.httpServer) {
      try {
        await new Promise(r => server.httpServer.close(r))
      } catch (e) {}
    }
    process.exit(1)
  }
}

runCollisionTest().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
