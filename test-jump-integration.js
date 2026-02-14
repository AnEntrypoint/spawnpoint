#!/usr/bin/env node
import { PhysicsIntegration } from './src/netcode/PhysicsIntegration.js'
import { PhysicsWorld } from './src/physics/World.js'
import { applyMovement } from './src/shared/movement.js'

const TICK_RATE = 60
const DT = 1 / TICK_RATE
const TEST_DURATION_TICKS = 100

const worldConfig = {
  gravity: [0, -9.81, 0],
  capsuleRadius: 0.4,
  capsuleHalfHeight: 0.9,
  crouchHalfHeight: 0.45,
  playerMass: 120
}

const movementConfig = {
  maxSpeed: 4.0,
  groundAccel: 10.0,
  airAccel: 1.0,
  friction: 6.0,
  stopSpeed: 2.0,
  jumpImpulse: 4.0,
  collisionRestitution: 0.2,
  collisionDamping: 0.25
}

async function runTest() {
  console.log('=== JUMP DYNAMICS INTEGRATION TEST (60 TPS) ===\n')
  console.log('Initializing physics world...')

  const physicsWorld = new PhysicsWorld(worldConfig)
  await physicsWorld.init()

  const physicsIntegration = new PhysicsIntegration(worldConfig)
  physicsIntegration.setPhysicsWorld(physicsWorld)

  console.log('Creating player...')
  const playerId = 'test-player'
  physicsIntegration.addPlayerCollider(playerId, worldConfig.capsuleRadius)

  const spawnPoint = [0, 3, 0]
  physicsIntegration.setPlayerPosition(playerId, spawnPoint)

  console.log(`Starting test at 60 TPS (${(DT * 1000).toFixed(2)}ms/tick)\n`)

  const measurements = {
    jumpStartTick: null,
    apexTick: null,
    landingTick: null,
    maxHeight: 0,
    positions: [],
    velocities: [],
    onGroundStates: [],
    ticks: [],
    jumpHeight: 0,
    apexTime: 0,
    hangTime: 0
  }

  let playerState = {
    position: [...spawnPoint],
    velocity: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    onGround: true,
    health: 100,
    crouch: 0,
    lookPitch: 0,
    lookYaw: 0
  }

  let lastInput = null
  let jumpPressed = false

  console.log('Tick-by-tick execution:\n')

  for (let tick = 0; tick < TEST_DURATION_TICKS; tick++) {
    const timeMs = tick * (1000 / TICK_RATE)

    let input = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      yaw: 0,
      pitch: 0,
      crouch: false,
      sprint: false
    }

    if (tick >= 10 && playerState.onGround && !jumpPressed) {
      input.jump = true
      jumpPressed = true
      measurements.jumpStartTick = tick
      console.log(`[${tick.toString().padStart(3)}ms ${timeMs.toFixed(1).padStart(6)}] JUMP INITIATED - vy will be set to ${movementConfig.jumpImpulse}`)
    }

    lastInput = input

    applyMovement(playerState, input, movementConfig, DT)

    const updated = physicsIntegration.updatePlayerPhysics(playerId, playerState, DT)
    Object.assign(playerState, updated)

    const y = playerState.position[1]
    const vy = playerState.velocity[1]
    const onGround = playerState.onGround

    measurements.ticks.push(tick)
    measurements.positions.push([...playerState.position])
    measurements.velocities.push([...playerState.velocity])
    measurements.onGroundStates.push(onGround)

    if (y > measurements.maxHeight) {
      measurements.maxHeight = y
    }

    if (measurements.jumpStartTick !== null && measurements.apexTick === null && vy <= 0.05) {
      measurements.apexTick = tick
      measurements.apexTime = (tick - measurements.jumpStartTick) * (1000 / TICK_RATE)
      console.log(`[${tick.toString().padStart(3)}] APEX REACHED - y=${y.toFixed(4)}m, vy=${vy.toFixed(3)}m/s, time=${measurements.apexTime.toFixed(1)}ms`)
    }

    if (measurements.apexTick !== null && measurements.landingTick === null && onGround) {
      measurements.landingTick = tick
      measurements.hangTime = (tick - measurements.jumpStartTick) * (1000 / TICK_RATE)
      console.log(`[${tick.toString().padStart(3)}] LANDING - time=${measurements.hangTime.toFixed(1)}ms`)
    }

    const shouldPrint = tick <= 12 || (measurements.jumpStartTick && tick >= measurements.jumpStartTick - 1 && tick <= measurements.jumpStartTick + 30)

    if (shouldPrint) {
      const marker = tick === measurements.jumpStartTick ? ' [JUMP]' :
                     tick === measurements.apexTick ? ' [APEX]' :
                     tick === measurements.landingTick ? ' [LAND]' : ''
      console.log(`  tick=${tick.toString().padStart(3)} time=${timeMs.toFixed(1).padStart(6)}ms y=${y.toFixed(4)}m vy=${vy.toFixed(3)}m/s onGround=${onGround ? 'Y' : 'N'}${marker}`)
    }

    if (measurements.landingTick && tick > measurements.landingTick + 5) {
      console.log('\n[Stopping test - landing confirmed]')
      break
    }
  }

  physicsWorld.destroy()

  return measurements
}

function analyzeResults(m) {
  console.log('\n=== RESULTS ANALYSIS ===\n')

  const tickToMs = t => t * (1000 / TICK_RATE)
  const jumpImpulse = 4.0
  const gravity = 9.81

  const expectedHeight = (jumpImpulse * jumpImpulse) / (2 * gravity)
  const expectedApexTime = jumpImpulse / gravity
  const expectedHangTime = 2 * expectedApexTime

  console.log('Physics calculations:')
  console.log(`  Jump impulse: ${jumpImpulse} m/s`)
  console.log(`  Gravity: ${gravity} m/s²`)
  console.log(`  Expected height: ${expectedHeight.toFixed(4)}m`)
  console.log(`  Expected apex time: ${(expectedApexTime * 1000).toFixed(1)}ms`)
  console.log(`  Expected hang time: ${(expectedHangTime * 1000).toFixed(1)}ms\n`)

  if (!m.jumpStartTick) {
    console.log('ERROR: Jump was not initiated!')
    return false
  }

  console.log('Measurements:')
  console.log(`  Jump initiated at tick ${m.jumpStartTick} (${tickToMs(m.jumpStartTick).toFixed(1)}ms)`)
  console.log(`  Max height: ${m.maxHeight.toFixed(4)}m`)
  if (m.apexTick !== null) {
    console.log(`  Apex at tick ${m.apexTick} (${tickToMs(m.apexTick).toFixed(1)}ms) - ${m.apexTime.toFixed(1)}ms after jump`)
  }
  if (m.landingTick !== null) {
    console.log(`  Landing at tick ${m.landingTick} (${tickToMs(m.landingTick).toFixed(1)}ms) - ${m.hangTime.toFixed(1)}ms total hang`)
  }

  console.log('\nValidation:')

  const heightDiff = m.maxHeight - expectedHeight
  const heightPercent = (heightDiff / expectedHeight * 100).toFixed(2)
  const heightOk = Math.abs(heightPercent) <= 5

  console.log(`  Height: ${m.maxHeight.toFixed(4)}m vs ${expectedHeight.toFixed(4)}m (${heightPercent}% ${heightDiff >= 0 ? '+' : ''}diff) ${heightOk ? '✓' : '✗'}`)

  if (m.apexTick !== null) {
    const apexDiff = m.apexTime - (expectedApexTime * 1000)
    const apexOk = Math.abs(apexDiff) <= 50
    console.log(`  Apex time: ${m.apexTime.toFixed(1)}ms vs ${(expectedApexTime * 1000).toFixed(1)}ms (${apexDiff >= 0 ? '+' : ''}${apexDiff.toFixed(1)}ms) ${apexOk ? '✓' : '✗'}`)
  }

  if (m.landingTick !== null) {
    const hangDiff = m.hangTime - (expectedHangTime * 1000)
    const hangOk = Math.abs(hangDiff) <= 100
    console.log(`  Hang time: ${m.hangTime.toFixed(1)}ms vs ${(expectedHangTime * 1000).toFixed(1)}ms (${hangDiff >= 0 ? '+' : ''}${hangDiff.toFixed(1)}ms) ${hangOk ? '✓' : '✗'}`)
  }

  console.log('\nAcceptance criteria:')
  const criteria = [
    { name: 'Height within ±5%', ok: heightOk },
    { name: 'Apex time within ±50ms', ok: m.apexTick !== null ? Math.abs(m.apexTime - expectedApexTime * 1000) <= 50 : false },
    { name: 'Hang time within ±100ms', ok: m.landingTick !== null ? Math.abs(m.hangTime - expectedHangTime * 1000) <= 100 : false },
    { name: 'Apex detected', ok: m.apexTick !== null },
    { name: 'Landing detected', ok: m.landingTick !== null }
  ]

  let passed = 0
  for (const c of criteria) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}`)
    if (c.ok) passed++
  }

  const allPassed = passed === criteria.length
  console.log(`\nResult: ${passed}/${criteria.length} criteria met`)

  return allPassed
}

async function main() {
  try {
    const results = await runTest()
    const passed = analyzeResults(results)
    process.exit(passed ? 0 : 1)
  } catch (err) {
    console.error('Fatal error:', err.message)
    console.error(err.stack)
    process.exit(1)
  }
}

main()
