#!/usr/bin/env node
import { PhysicsIntegration } from './src/netcode/PhysicsIntegration.js'
import { PhysicsWorld } from './src/physics/World.js'
import { applyMovement } from './src/shared/movement.js'

const TICK_RATE = 60
const TICK_DURATION = 1 / TICK_RATE
const TEST_TICKS = 100

const config = {
  gravity: [0, -9.81, 0],
  capsuleRadius: 0.4,
  capsuleHalfHeight: 0.9,
  crouchHalfHeight: 0.45,
  playerMass: 120
}

const movement = {
  maxSpeed: 4.0,
  groundAccel: 10.0,
  airAccel: 1.0,
  friction: 6.0,
  stopSpeed: 2.0,
  jumpImpulse: 4.0,
  collisionRestitution: 0.2,
  collisionDamping: 0.25
}

let measurements = {
  jumpStartTick: null,
  apexTick: null,
  landingTick: null,
  maxHeight: 0,
  positions: [],
  velocities: [],
  onGroundStates: [],
  ticks: [],
  jumpInitiated: false,
  apexDetected: false,
  landingDetected: false
}

async function runTest() {
  console.log('[TEST] Initializing physics world...')
  const physicsWorld = new PhysicsWorld(config)
  await physicsWorld.init()

  const physicsIntegration = new PhysicsIntegration(config)
  physicsIntegration.setPhysicsWorld(physicsWorld)

  console.log('[TEST] Creating player collider...')
  const playerId = 'test-player'
  physicsIntegration.addPlayerCollider(playerId, config.capsuleRadius)

  console.log('[TEST] Starting jump dynamics test (60 TPS)...\n')

  let playerState = {
    position: [0, 3, 0],
    velocity: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    onGround: true,
    health: 100,
    crouch: 0
  }

  physicsIntegration.setPlayerPosition(playerId, playerState.position)

  for (let tick = 0; tick < TEST_TICKS; tick++) {
    const timeMs = tick * (1000 / TICK_RATE)

    const input = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: measurements.jumpInitiated ? false : (tick >= 10 && playerState.onGround && !measurements.jumpInitiated),
      yaw: 0,
      pitch: 0,
      crouch: false,
      sprint: false
    }

    if (input.jump && !measurements.jumpInitiated) {
      console.log(`[TEST] Tick ${tick} (${timeMs.toFixed(1)}ms): Jump initiated`)
      measurements.jumpStartTick = tick
      measurements.jumpInitiated = true
    }

    applyMovement(playerState, input, movement, TICK_DURATION)

    const updated = physicsIntegration.updatePlayerPhysics(playerId, playerState, TICK_DURATION)
    playerState.position = updated.position
    playerState.velocity = updated.velocity
    playerState.onGround = updated.onGround

    const y = playerState.position[1]
    const vy = playerState.velocity[1]

    measurements.ticks.push(tick)
    measurements.positions.push([...playerState.position])
    measurements.velocities.push([...playerState.velocity])
    measurements.onGroundStates.push(playerState.onGround)

    if (y > measurements.maxHeight) {
      measurements.maxHeight = y
    }

    if (measurements.jumpInitiated && !measurements.apexDetected && vy <= 0.05) {
      console.log(`[TEST] Tick ${tick} (${timeMs.toFixed(1)}ms): Apex reached at height ${y.toFixed(4)}m, vy=${vy.toFixed(3)}m/s`)
      measurements.apexTick = tick
      measurements.apexDetected = true
    }

    if (measurements.jumpInitiated && measurements.apexDetected && playerState.onGround && !measurements.landingDetected) {
      console.log(`[TEST] Tick ${tick} (${timeMs.toFixed(1)}ms): Landing detected`)
      measurements.landingTick = tick
      measurements.landingDetected = true
    }

    if (tick <= 12 || (measurements.jumpStartTick && tick >= measurements.jumpStartTick - 2 && tick <= measurements.jumpStartTick + 30)) {
      console.log(`  Tick ${tick.toString().padStart(3)}: y=${y.toFixed(4)}m vy=${vy.toFixed(3)}m/s ground=${playerState.onGround ? 'yes' : 'no '}`)
    }
  }

  return measurements
}

function analyzeResults(measurements) {
  console.log('\n=== JUMP DYNAMICS TEST RESULTS (60 TPS) ===\n')

  if (!measurements.jumpStartTick) {
    console.log('ERROR: Jump was not initiated')
    return false
  }

  const tickToMs = tick => tick * (1000 / TICK_RATE)
  const jumpStartMs = tickToMs(measurements.jumpStartTick)
  const apexMs = measurements.apexTick !== null ? tickToMs(measurements.apexTick) : null
  const landingMs = measurements.landingTick !== null ? tickToMs(measurements.landingTick) : null

  console.log('Raw measurements:')
  console.log(`  Jump initiated at: tick ${measurements.jumpStartTick} (${jumpStartMs.toFixed(1)}ms)`)
  console.log(`  Apex reached at: tick ${measurements.apexTick} (${apexMs?.toFixed(1) || 'N/A'}ms)`)
  console.log(`  Landing at: tick ${measurements.landingTick} (${landingMs?.toFixed(1) || 'N/A'}ms)`)
  console.log(`  Max height: ${measurements.maxHeight.toFixed(4)}m`)

  console.log('\nPhysics calculations (60 TPS = 16.67ms/tick):')
  const jumpImpulse = 4.0
  const gravity = 9.81
  const expectedHeight = (jumpImpulse * jumpImpulse) / (2 * gravity)
  const expectedApexTime = jumpImpulse / gravity
  const expectedHangTime = 2 * expectedApexTime

  console.log(`  Jump impulse: ${jumpImpulse.toFixed(1)} m/s`)
  console.log(`  Gravity: ${gravity.toFixed(2)} m/s²`)
  console.log(`  Expected jump height: ${expectedHeight.toFixed(4)}m`)
  console.log(`  Expected apex time: ${(expectedApexTime * 1000).toFixed(1)}ms (${(expectedApexTime / (1000 / TICK_RATE)).toFixed(2)} ticks)`)
  console.log(`  Expected hang time: ${(expectedHangTime * 1000).toFixed(1)}ms (${(expectedHangTime / (1000 / TICK_RATE)).toFixed(2)} ticks)`)

  console.log('\nMeasured vs Expected:')

  const heightDiff = measurements.maxHeight - expectedHeight
  const heightPercent = (heightDiff / expectedHeight * 100).toFixed(2)
  const heightOk = Math.abs(heightPercent) <= 5
  console.log(`  Height: ${measurements.maxHeight.toFixed(4)}m vs ${expectedHeight.toFixed(4)}m expected (${heightPercent}% diff) ${heightOk ? '✓' : '✗'}`)

  if (measurements.apexTick !== null) {
    const apexTimeDiff = apexMs - (expectedApexTime * 1000)
    const apexOk = Math.abs(apexTimeDiff) <= 50
    console.log(`  Apex time: ${apexMs.toFixed(1)}ms vs ${(expectedApexTime * 1000).toFixed(1)}ms expected (${apexTimeDiff >= 0 ? '+' : ''}${apexTimeDiff.toFixed(1)}ms) ${apexOk ? '✓' : '✗'}`)
  }

  if (measurements.landingTick !== null) {
    const hangTimeDiff = (landingMs - jumpStartMs) - (expectedHangTime * 1000)
    const hangOk = Math.abs(hangTimeDiff) <= 100
    console.log(`  Hang time: ${(landingMs - jumpStartMs).toFixed(1)}ms vs ${(expectedHangTime * 1000).toFixed(1)}ms expected (${hangTimeDiff >= 0 ? '+' : ''}${hangTimeDiff.toFixed(1)}ms) ${hangOk ? '✓' : '✗'}`)
  }

  console.log('\nVelocity profile at key moments:')
  if (measurements.jumpStartTick !== null && measurements.jumpStartTick < measurements.velocities.length) {
    const idx = measurements.jumpStartTick
    const vel = measurements.velocities[idx]
    console.log(`  At jump: vx=${vel[0].toFixed(3)}, vy=${vel[1].toFixed(3)}, vz=${vel[2].toFixed(3)} m/s`)
  }

  if (measurements.apexTick !== null && measurements.apexTick < measurements.velocities.length) {
    const idx = measurements.apexTick
    const vel = measurements.velocities[idx]
    console.log(`  At apex: vx=${vel[0].toFixed(3)}, vy=${vel[1].toFixed(3)}, vz=${vel[2].toFixed(3)} m/s`)
  }

  if (measurements.landingTick !== null && measurements.landingTick < measurements.velocities.length) {
    const idx = measurements.landingTick
    const vel = measurements.velocities[idx]
    console.log(`  At landing: vx=${vel[0].toFixed(3)}, vy=${vel[1].toFixed(3)}, vz=${vel[2].toFixed(3)} m/s`)
  }

  console.log('\nDetailed position trace:')
  for (let i = 0; i < measurements.positions.length; i++) {
    const tick = measurements.ticks[i]
    const pos = measurements.positions[i]
    const vel = measurements.velocities[i]
    const ground = measurements.onGroundStates[i]

    if (tick <= 12 || (measurements.jumpStartTick && tick >= measurements.jumpStartTick - 1 && tick <= measurements.jumpStartTick + 30)) {
      const marker = tick === measurements.jumpStartTick ? ' [JUMP]' :
                     tick === measurements.apexTick ? ' [APEX]' :
                     tick === measurements.landingTick ? ' [LAND]' : ''
      const timeMs = tickToMs(tick)
      console.log(`  Tick ${tick.toString().padStart(3)} (${timeMs.toFixed(1).padStart(6)}ms): y=${pos[1].toFixed(4)}m vy=${vel[1].toFixed(3)}m/s ground=${ground ? 'Y' : 'N'}${marker}`)
    }
  }

  console.log('\nAcceptance criteria:')
  const criteria = [
    { name: 'Height tolerance (±5%)', ok: heightOk },
    { name: 'Apex time (±50ms)', ok: measurements.apexTick !== null ? Math.abs(apexMs - (expectedApexTime * 1000)) <= 50 : false },
    { name: 'Hang time (±100ms)', ok: measurements.landingTick !== null ? Math.abs((landingMs - jumpStartMs) - (expectedHangTime * 1000)) <= 100 : false },
    { name: 'Apex detected', ok: measurements.apexDetected },
    { name: 'Landing detected', ok: measurements.landingDetected }
  ]

  let allPassed = true
  for (const criterion of criteria) {
    console.log(`  ${criterion.ok ? '✓' : '✗'} ${criterion.name}`)
    if (!criterion.ok) allPassed = false
  }

  return allPassed
}

async function main() {
  try {
    const measurements = await runTest()
    const passed = analyzeResults(measurements)
    process.exit(passed ? 0 : 1)
  } catch (err) {
    console.error('[TEST] Fatal error:', err.message)
    console.error(err.stack)
    process.exit(1)
  }
}

main()
