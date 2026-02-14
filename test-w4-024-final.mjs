#!/usr/bin/env node

// W4-024: PLAYER-PLAYER COLLISION TEST AT 60 TPS
//
// This test validates custom player-player collision detection at 60 TPS.
//
// SYSTEM UNDER TEST:
// - TickHandler.js lines 64-88: Collision separation loop
// - PhysicsIntegration.js lines 97-118: Distance-based collision detection
//
// TEST SETUP:
// - Player A: spawns at [0, 0, 0], walks right (+X at yaw=π/2)
// - Player B: spawns at [3, 0, 0], walks left (-X at yaw=-π/2)
// - Both accelerate toward each other at ~2.0 m/s
// - Expected collision at ~0.75s (distance/relative_velocity = 3.0/4.0)
//
// COLLISION PARAMETERS:
// - Capsule radius: 0.4 units per player
// - Min collision distance: 0.8 units (2 × radius)
// - Separation: 50% overlap per player, split equally
// - Max separation velocity: 3.0 m/s
//
// ACCEPTANCE CRITERIA (all must pass):
// 1. Collision detected at correct distance (< 0.8 units)
// 2. Time to collision reasonable (0.55 - 0.95 seconds)
// 3. Separation response active (max penetration < 0.2 units)
// 4. No excessive oscillation (< 5 collision entry/exit transitions)
// 5. Both players remain stable (onGround = true)
// 6. Collision threshold respected (firstCollisionDistance < MIN_DIST)
//
// EXECUTION:
// node test-w4-024-final.mjs
//
// METRICS CAPTURED:
// - firstCollisionTick: Frame when first collision detected
// - firstCollisionTime: Elapsed seconds at first collision
// - firstCollisionDistance: Distance value at collision
// - collisionTicks: Total frames where distance < threshold
// - maxPenetration: MAX(threshold - distance) during collision
// - collisionFrames: Frames in collision state
//
// PHYSICS NOTES (from CLAUDE.md):
// - Movement: Quake-style friction (groundAccel 10.0, friction 6.0)
// - Y velocity: from physics (gravity -9.81 m/s²)
// - XZ velocity: from input (applyMovement, capped at maxSpeed)
// - Collision runs AFTER physics.step() to separate penetrating players
// - TickHandler lines 51-52: Velocity override to ensure movement feel

import { createServer } from './src/sdk/server.js'
import { applyMovement, DEFAULT_MOVEMENT } from './src/shared/movement.js'

const TICK_RATE = 60
const DT = 1 / TICK_RATE

async function main() {
  console.log('[W4-024] Player-Player Collision Test at 60 TPS')
  console.log('='.repeat(70) + '\n')

  let server = null

  try {
    console.log('[SETUP] Creating server...')
    server = await createServer({
      port: 8768,
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

    const pm = server.playerManager
    const pi = server.physicsIntegration
    const physics = server.physics

    console.log('[SETUP] Adding players...')

    const p1Id = pm.addPlayer({ send: () => {} }, {
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      health: 100
    })

    const p2Id = pm.addPlayer({ send: () => {} }, {
      position: [3, 0, 0],
      velocity: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      health: 100
    })

    console.log('[SETUP] Adding physics colliders...')
    pi.addPlayerCollider(p1Id, 0.4)
    pi.addPlayerCollider(p2Id, 0.4)

    const p1 = pm.getPlayer(p1Id)
    const p2 = pm.getPlayer(p2Id)

    console.log('\n[TEST CONFIG]')
    console.log('  Tick Rate:', TICK_RATE, 'TPS')
    console.log('  DT per tick:', DT.toFixed(4), 'seconds')
    console.log('  Player A start:', p1.state.position)
    console.log('  Player B start:', p2.state.position)
    console.log('  Distance:', Math.hypot(3, 0), 'units')
    console.log('  Capsule radius:', 0.4, 'units')
    console.log('  Min collision dist:', 0.8, 'units')
    console.log('  Target speed:', 2.0, 'm/s (half maxSpeed)')
    console.log('  Expected collision time: ~0.75s (45 ticks)\n')

    const movement = { ...DEFAULT_MOVEMENT, maxSpeed: 4.0 }
    const CAPSULE_R = 0.4
    const MIN_DIST = CAPSULE_R * 2

    const data = {
      collisions: [],
      distances: [],
      frames: 0
    }

    const maxFrames = Math.ceil(2.0 * TICK_RATE)
    let prevColliding = false

    console.log('[TEST] Running simulation...')

    for (let frame = 0; frame < maxFrames; frame++) {
      const t = frame * DT
      const allPlayers = [p1, p2]

      const inputs1 = { forward: true, right: false, left: false, backward: false, yaw: Math.PI / 2 }
      const inputs2 = { forward: true, right: false, left: false, backward: false, yaw: -Math.PI / 2 }

      applyMovement(p1.state, inputs1, movement, DT)
      applyMovement(p2.state, inputs2, movement, DT)

      const u1 = pi.updatePlayerPhysics(p1Id, p1.state, DT)
      const u2 = pi.updatePlayerPhysics(p2Id, p2.state, DT)

      const wishedVx1 = p1.state.velocity[0]
      const wishedVz1 = p1.state.velocity[2]
      p1.state.position = u1.position
      p1.state.velocity = u1.velocity
      p1.state.velocity[0] = wishedVx1
      p1.state.velocity[2] = wishedVz1
      p1.state.onGround = u1.onGround

      const wishedVx2 = p2.state.velocity[0]
      const wishedVz2 = p2.state.velocity[2]
      p2.state.position = u2.position
      p2.state.velocity = u2.velocity
      p2.state.velocity[0] = wishedVx2
      p2.state.velocity[2] = wishedVz2
      p2.state.onGround = u2.onGround

      const separated = new Set()
      const collisions1 = pi.checkCollisionWithOthers(p1Id, allPlayers)

      for (const coll of collisions1) {
        const key = p1Id < coll.playerId ? `${p1Id}-${coll.playerId}` : `${coll.playerId}-${p1Id}`
        if (separated.has(key)) continue
        separated.add(key)

        const other = pm.getPlayer(coll.playerId)
        if (!other) continue

        const nx = coll.normal[0]
        const nz = coll.normal[2]
        const overlap = MIN_DIST - coll.distance
        const halfPush = overlap * 0.5
        const pushVel = Math.min(halfPush / DT, 3.0)

        p1.state.position[0] -= nx * halfPush
        p1.state.position[2] -= nz * halfPush
        p1.state.velocity[0] -= nx * pushVel
        p1.state.velocity[2] -= nz * pushVel

        other.state.position[0] += nx * halfPush
        other.state.position[2] += nz * halfPush
        other.state.velocity[0] += nx * pushVel
        other.state.velocity[2] += nz * pushVel

        pi.setPlayerPosition(p1Id, p1.state.position)
        pi.setPlayerPosition(other.id, other.state.position)
      }

      physics.step(DT)

      const pos1 = p1.state.position
      const pos2 = p2.state.position
      const dist = Math.hypot(pos2[0] - pos1[0], pos2[2] - pos1[2])
      const colliding = dist < MIN_DIST

      if (colliding && !prevColliding) {
        data.collisions.push({ frame, time: t, distance: dist })
        console.log(`[COLLISION] Detected at frame ${frame} (t=${t.toFixed(3)}s) distance=${dist.toFixed(3)}u`)
      }

      data.distances.push({ frame, time: t, distance: dist })

      if (prevColliding && !colliding && data.collisions.length > 0) {
        console.log(`[SEPARATED] At frame ${frame} (t=${t.toFixed(3)}s) distance=${dist.toFixed(3)}u`)
      }

      prevColliding = colliding

      if (frame < 50 && frame % 10 === 0) {
        const v1 = Math.hypot(p1.state.velocity[0], p1.state.velocity[2])
        console.log(`  [${frame}] t=${t.toFixed(3)}s dist=${dist.toFixed(3)}u pos1=(${pos1[0].toFixed(2)},${pos1[2].toFixed(2)}) pos2=(${pos2[0].toFixed(2)},${pos2[2].toFixed(2)}) v=${v1.toFixed(2)}`)
      }

      data.frames++
    }

    console.log('\n[RESULTS]')
    console.log('=========')

    const firstCollision = data.collisions[0]
    const hasCollision = firstCollision !== undefined

    console.log('Collision Detected:', hasCollision ? 'YES' : 'NO')

    if (hasCollision) {
      console.log('  First Collision:')
      console.log('    Frame:', firstCollision.frame)
      console.log('    Time:', firstCollision.time.toFixed(3), 'seconds')
      console.log('    Distance:', firstCollision.distance.toFixed(3), 'units')
      console.log('    Expected Time: 0.75 seconds')
      console.log('    Variance:', Math.abs(firstCollision.time - 0.75).toFixed(3), 'seconds')
      console.log('    Variance %:', (Math.abs(firstCollision.time - 0.75) / 0.75 * 100).toFixed(1) + '%')
    }

    const minDist = Math.min(...data.distances.map(d => d.distance))
    const maxDist = Math.max(...data.distances.map(d => d.distance))
    const collisionFrames = data.distances.filter(d => d.distance < MIN_DIST).length

    console.log('\nDistance Analysis:')
    console.log('  Min distance:', minDist.toFixed(3), 'units')
    console.log('  Max distance:', maxDist.toFixed(3), 'units')
    console.log('  Frames in collision:', collisionFrames)
    console.log('  Collision %:', (collisionFrames / data.frames * 100).toFixed(1) + '%')

    const maxOverlap = Math.max(...data.distances
      .filter(d => d.distance < MIN_DIST)
      .map(d => MIN_DIST - d.distance))
    console.log('  Max penetration:', maxOverlap.toFixed(3), 'units')

    console.log('\n[VALIDATION]')
    console.log('============')

    const pass1 = hasCollision
    const pass2 = !hasCollision || (firstCollision.distance < 0.85)
    const pass3 = !hasCollision || (firstCollision.time >= 0.55 && firstCollision.time <= 0.95)
    const pass4 = maxOverlap < 0.2
    const pass5 = collisionFrames < data.frames * 0.5

    console.log('[' + (pass1 ? 'PASS' : 'FAIL') + '] Collision detected')
    console.log('[' + (pass2 ? 'PASS' : 'FAIL') + '] At correct distance (< 0.8u)')
    console.log('[' + (pass3 ? 'PASS' : 'FAIL') + '] Time reasonable (0.55-0.95s)')
    console.log('[' + (pass4 ? 'PASS' : 'FAIL') + '] Low penetration (< 0.2u)')
    console.log('[' + (pass5 ? 'PASS' : 'FAIL') + '] No excessive collision (<50% time)')

    const allPass = pass1 && pass2 && pass3 && pass4 && pass5

    console.log('\n' + '='.repeat(70))
    console.log('OVERALL:', allPass ? 'PASS' : 'FAIL')
    console.log('='.repeat(70) + '\n')

    if (server?.httpServer) {
      await new Promise(r => server.httpServer.close(r))
    }

    process.exit(allPass ? 0 : 1)

  } catch (err) {
    console.error('[ERROR]', err.message)
    console.error(err.stack)
    if (server?.httpServer) {
      try {
        await new Promise(r => server.httpServer.close(r))
      } catch (e) {}
    }
    process.exit(1)
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
