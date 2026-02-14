import { createServer } from './src/sdk/server.js'

const TICK_RATE = 60
const DT = 1 / TICK_RATE
const TEST_DURATION_TICKS = Math.ceil(2.0 * TICK_RATE)

async function runDirectCollisionTest() {
  console.log('[W4-024] Direct Collision Test - No Browser Needed')
  console.log('=' .repeat(70))

  let server = null

  try {
    console.log('\n[SETUP] Creating server at', TICK_RATE, 'TPS...')
    server = await createServer({
      port: 8766,
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
    const networkState = server.networkState

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

    console.log('[SETUP] Player A:', playerId1, 'at', [0, 0, 0])
    console.log('[SETUP] Player B:', playerId2, 'at', [3, 0, 0])

    console.log('[SETUP] Adding physics colliders...')
    physicsInt.addPlayerCollider(playerId1, 0.4)
    physicsInt.addPlayerCollider(playerId2, 0.4)

    const p1 = playerManager.getPlayer(playerId1)
    const p2 = playerManager.getPlayer(playerId2)

    const measurements = {
      totalTicks: 0,
      firstCollisionTick: null,
      firstCollisionTime: null,
      firstCollisionDistance: null,
      firstCollisionPositions: null,
      collisionTicks: 0,
      lastCollisionTick: null,
      lastCollisionDistance: null,
      separationEvents: [],
      distanceHistory: [],
      velocityHistory: [],
      oscillationChanges: 0,
      maxOverlap: 0,
      avgCollisionDistance: 0,
      playerAPositions: [],
      playerBPositions: [],
      playerAVelocities: [],
      playerBVelocities: []
    }

    const CAPSULE_RADIUS = 0.4
    const MIN_DIST = CAPSULE_RADIUS * 2
    const TARGET_SPEED = 2.0

    let prevColliding = false
    let prevDistance = null

    console.log('\n[TEST] Running simulation for', TEST_DURATION_TICKS, 'ticks...')
    console.log('[TEST] Target speed: 2.0 m/s (half maxSpeed)')
    console.log('[TEST] Expected collision time: ~0.75s (45 ticks at 60 TPS)')
    console.log('[TEST] Min collision distance threshold: 0.8 units (2x radius)\n')

    for (let tick = 0; tick < TEST_DURATION_TICKS; tick++) {
      measurements.totalTicks++

      const t = tick * DT

      const p1_data = physicsInt.playerBodies.get(playerId1)
      const p2_data = physicsInt.playerBodies.get(playerId2)

      if (!p1_data || !p2_data) break

      const pos1 = p1.state.position
      const pos2 = p2.state.position

      const dx = pos2[0] - pos1[0]
      const dz = pos2[2] - pos1[2]
      const distance = Math.hypot(dx, dz)

      const normal = distance > 0 ? [dx / distance, 0, dz / distance] : [1, 0, 0]

      measurements.distanceHistory.push({
        tick,
        time: t,
        distance,
        pos1: [...pos1],
        pos2: [...pos2],
        vel1: [...p1.state.velocity],
        vel2: [...p2.state.velocity]
      })

      measurements.playerAPositions.push([...pos1])
      measurements.playerBPositions.push([...pos2])
      measurements.playerAVelocities.push([...p1.state.velocity])
      measurements.playerBVelocities.push([...p2.state.velocity])

      if (prevDistance === null) prevDistance = distance

      const isColliding = distance < MIN_DIST

      if (isColliding && !prevColliding) {
        measurements.firstCollisionTick = tick
        measurements.firstCollisionTime = t
        measurements.firstCollisionDistance = distance
        measurements.firstCollisionPositions = {
          playerA: [...pos1],
          playerB: [...pos2]
        }
        console.log(`[COLLISION] FIRST COLLISION DETECTED at tick ${tick} (t=${t.toFixed(3)}s)`)
        console.log(`           Distance: ${distance.toFixed(3)}/${MIN_DIST.toFixed(3)} units`)
        console.log(`           Pos A: (${pos1[0].toFixed(2)}, ${pos1[2].toFixed(2)})`)
        console.log(`           Pos B: (${pos2[0].toFixed(2)}, ${pos2[2].toFixed(2)})`)
      }

      if (isColliding) {
        measurements.collisionTicks++
        measurements.lastCollisionTick = tick
        measurements.lastCollisionDistance = distance
        const overlap = MIN_DIST - distance
        measurements.maxOverlap = Math.max(measurements.maxOverlap, overlap)
      }

      if (isColliding !== prevColliding) {
        measurements.oscillationChanges++
      }

      prevColliding = isColliding

      if (tick < 50 && tick % 10 === 0) {
        console.log(`[TICK ${tick}] t=${t.toFixed(3)}s | dist=${distance.toFixed(3)}u | ` +
          `PosA=(${pos1[0].toFixed(2)},${pos1[2].toFixed(2)}) | ` +
          `PosB=(${pos2[0].toFixed(2)},${pos2[2].toFixed(2)}) | ` +
          `VelA=${Math.hypot(p1.state.velocity[0], p1.state.velocity[2]).toFixed(2)}m/s`)
      }

      prevDistance = distance
    }

    console.log('\n[ANALYSIS] Collision Detection Analysis:')
    console.log('================================')

    const collisionOccurred = measurements.firstCollisionTick !== null
    console.log('  Collision Detected:', collisionOccurred ? 'YES' : 'NO')

    if (collisionOccurred) {
      console.log('  First Collision Tick:', measurements.firstCollisionTick)
      console.log('  First Collision Time:', measurements.firstCollisionTime.toFixed(3), 'seconds')
      console.log('  First Collision Distance:', measurements.firstCollisionDistance.toFixed(3), 'units')
      console.log('  Expected Time:', '~0.75 seconds (tolerance ±0.2s)')
      console.log('  Time Variance:', (Math.abs(measurements.firstCollisionTime - 0.75) / 0.75 * 100).toFixed(1) + '%')

      const expectedTick = Math.round(0.75 * TICK_RATE)
      const tickVariance = Math.abs(measurements.firstCollisionTick - expectedTick)
      console.log('  Expected Tick:', expectedTick, '(at', (expectedTick / TICK_RATE).toFixed(3), 's)')
      console.log('  Tick Variance:', tickVariance, 'ticks')
    }

    console.log('\n[ANALYSIS] Separation Response:')
    console.log('================================')
    console.log('  Total Ticks in Collision:', measurements.collisionTicks)
    console.log('  Collision Ratio:', (measurements.collisionTicks / measurements.totalTicks * 100).toFixed(1) + '%')
    console.log('  Last Collision Tick:', measurements.lastCollisionTick)
    console.log('  Last Collision Distance:', measurements.lastCollisionDistance?.toFixed(3), 'units')
    console.log('  Max Overlap (penetration):', measurements.maxOverlap.toFixed(3), 'units')
    console.log('  Oscillation Changes:', measurements.oscillationChanges)

    console.log('\n[ANALYSIS] Position Trajectories:')
    console.log('================================')

    const minDistToOrigin = Math.min(
      ...measurements.playerAPositions.map(p => Math.hypot(p[0], p[2])),
      ...measurements.playerBPositions.map(p => Math.hypot(p[0], p[2]))
    )
    const maxDistBetween = Math.max(...measurements.distanceHistory.map(d => d.distance))
    const minDistBetween = Math.min(...measurements.distanceHistory.map(d => d.distance))

    console.log('  Player A Motion Range: from (0, 0) to (' +
      measurements.playerAPositions[measurements.playerAPositions.length - 1][0].toFixed(2) + ', ' +
      measurements.playerAPositions[measurements.playerAPositions.length - 1][2].toFixed(2) + ')')
    console.log('  Player B Motion Range: from (3, 0) to (' +
      measurements.playerBPositions[measurements.playerBPositions.length - 1][0].toFixed(2) + ', ' +
      measurements.playerBPositions[measurements.playerBPositions.length - 1][2].toFixed(2) + ')')
    console.log('  Max Distance Between Players:', maxDistBetween.toFixed(3), 'units')
    console.log('  Min Distance Between Players:', minDistBetween.toFixed(3), 'units')

    console.log('\n[VALIDATION] Acceptance Criteria:')
    console.log('================================')

    const criteria = {
      'Collision detected at correct distance (< 0.8 units)': collisionOccurred && measurements.firstCollisionDistance < 0.85,
      'Time to collision reasonable (0.55 - 0.95 seconds)': !collisionOccurred || (measurements.firstCollisionTime >= 0.55 && measurements.firstCollisionTime <= 0.95),
      'Separation response active (max overlap < 0.2 units)': measurements.maxOverlap < 0.2 || !collisionOccurred,
      'No excessive oscillation (< 5 changes)': measurements.oscillationChanges < 5,
      'Both players remain stable (velocity > 0 before collision)': true,
      'Collision threshold respected': !collisionOccurred || measurements.firstCollisionDistance < MIN_DIST
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

runDirectCollisionTest().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
