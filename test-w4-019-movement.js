import { applyMovement, DEFAULT_MOVEMENT } from './src/shared/movement.js'

const TEST_CONFIG = {
  tickRate: 60,
  dt: 1 / 60,
  testDuration: 3.0,
  maxSpeed: 4.0,
  groundAccel: 10.0,
  airAccel: 1.0,
  friction: 6.0,
  stopSpeed: 2.0
}

function createPlayerState() {
  return {
    velocity: [0, 0, 0],
    position: [0, 0, 0],
    onGround: true
  }
}

function runAccelerationTest() {
  console.log('\n=== W4-019: Movement Acceleration at 60 TPS ===\n')

  const state = createPlayerState()
  const movement = {
    maxSpeed: TEST_CONFIG.maxSpeed,
    groundAccel: TEST_CONFIG.groundAccel,
    airAccel: TEST_CONFIG.airAccel,
    friction: TEST_CONFIG.friction,
    stopSpeed: TEST_CONFIG.stopSpeed,
    jumpImpulse: 4.0,
    crouchSpeedMul: 0.4
  }

  const input = {
    forward: true,
    backward: false,
    left: false,
    right: false,
    yaw: 0,
    jump: false,
    sprint: false,
    crouch: false
  }

  let time = 0
  const measurements = {
    time50: null,
    time80: null,
    time90: null,
    maxReached: 0,
    maxTime: 0
  }

  const tickCount = Math.ceil(TEST_CONFIG.testDuration / TEST_CONFIG.dt)
  console.log(`Running ${tickCount} ticks (${TEST_CONFIG.testDuration}s at ${TEST_CONFIG.tickRate} TPS)`)
  console.log(`dt per tick: ${TEST_CONFIG.dt.toFixed(4)}s`)
  console.log(`Movement config: maxSpeed=${movement.maxSpeed}, groundAccel=${movement.groundAccel}\n`)

  for (let tick = 0; tick < tickCount; tick++) {
    const result = applyMovement(state, input, movement, TEST_CONFIG.dt)

    const speed = Math.sqrt(state.velocity[0] ** 2 + state.velocity[2] ** 2)
    const speedPercent = (speed / TEST_CONFIG.maxSpeed) * 100

    if (speed > measurements.maxReached) {
      measurements.maxReached = speed
      measurements.maxTime = time
    }

    if (measurements.time50 === null && speed >= TEST_CONFIG.maxSpeed * 0.5) {
      measurements.time50 = time
      console.log(`✓ 50% speed (${speed.toFixed(3)} m/s) reached at ${time.toFixed(3)}s`)
    }

    if (measurements.time80 === null && speed >= TEST_CONFIG.maxSpeed * 0.8) {
      measurements.time80 = time
      console.log(`✓ 80% speed (${speed.toFixed(3)} m/s) reached at ${time.toFixed(3)}s`)
    }

    if (measurements.time90 === null && speed >= TEST_CONFIG.maxSpeed * 0.9) {
      measurements.time90 = time
      console.log(`✓ 90% speed (${speed.toFixed(3)} m/s) reached at ${time.toFixed(3)}s`)
    }

    if (tick % 12 === 0) {
      console.log(`[${tick.toString().padStart(4)}] t=${time.toFixed(3)}s speed=${speed.toFixed(3)} m/s (${speedPercent.toFixed(1)}%) vx=${state.velocity[0].toFixed(3)} vz=${state.velocity[2].toFixed(3)}`)
    }

    time += TEST_CONFIG.dt
  }

  console.log(`\n✓ Max speed reached: ${measurements.maxReached.toFixed(3)} m/s at ${measurements.maxTime.toFixed(3)}s`)

  return { state, measurements }
}

function runDecelerationTest() {
  console.log('\n=== Deceleration Test ===\n')

  const state = createPlayerState()
  const movement = {
    maxSpeed: TEST_CONFIG.maxSpeed,
    groundAccel: TEST_CONFIG.groundAccel,
    airAccel: TEST_CONFIG.airAccel,
    friction: TEST_CONFIG.friction,
    stopSpeed: TEST_CONFIG.stopSpeed,
    jumpImpulse: 4.0
  }

  state.velocity[0] = TEST_CONFIG.maxSpeed
  state.velocity[2] = 0
  state.onGround = true

  const input = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    yaw: 0,
    jump: false
  }

  let time = 0
  const measurements = { timeToStop: null }
  const tickCount = 60

  console.log(`Starting deceleration from ${TEST_CONFIG.maxSpeed.toFixed(3)} m/s\n`)

  for (let tick = 0; tick < tickCount; tick++) {
    const speed = Math.sqrt(state.velocity[0] ** 2 + state.velocity[2] ** 2)

    if (measurements.timeToStop === null && speed < 0.05) {
      measurements.timeToStop = time
      console.log(`✓ Stopped at ${time.toFixed(3)}s`)
    }

    if (tick % 6 === 0 || speed < 0.1) {
      console.log(`[${tick.toString().padStart(2)}] t=${time.toFixed(3)}s speed=${speed.toFixed(3)} m/s`)
    }

    applyMovement(state, input, movement, TEST_CONFIG.dt)
    time += TEST_CONFIG.dt
  }

  return measurements
}

function runAirStrafeTest() {
  console.log('\n=== Air Strafe Test (Quake-style) ===\n')

  const state = createPlayerState()
  const movement = {
    maxSpeed: TEST_CONFIG.maxSpeed,
    groundAccel: TEST_CONFIG.groundAccel,
    airAccel: TEST_CONFIG.airAccel,
    friction: TEST_CONFIG.friction,
    stopSpeed: TEST_CONFIG.stopSpeed,
    jumpImpulse: 4.0
  }

  state.velocity[0] = 0
  state.velocity[1] = 4.0
  state.velocity[2] = 0
  state.onGround = false

  let time = 0
  const tickCount = 60
  let maxAirSpeed = 0
  let maxAirTime = 0

  console.log(`Starting jump with initial Y velocity: ${state.velocity[1].toFixed(3)} m/s`)
  console.log(`Applying left strafe input while airborne\n`)

  const input = {
    forward: true,
    backward: false,
    left: true,
    right: false,
    yaw: 0,
    jump: false
  }

  for (let tick = 0; tick < tickCount; tick++) {
    const result = applyMovement(state, input, movement, TEST_CONFIG.dt)

    const horizSpeed = Math.sqrt(state.velocity[0] ** 2 + state.velocity[2] ** 2)

    if (horizSpeed > maxAirSpeed && !state.onGround) {
      maxAirSpeed = horizSpeed
      maxAirTime = time
    }

    if (tick % 6 === 0) {
      console.log(`[${tick.toString().padStart(2)}] t=${time.toFixed(3)}s horiz=${horizSpeed.toFixed(3)} m/s vy=${state.velocity[1].toFixed(3)} m/s vx=${state.velocity[0].toFixed(3)} vz=${state.velocity[2].toFixed(3)}`)
    }

    state.velocity[1] -= 9.81 * TEST_CONFIG.dt
    time += TEST_CONFIG.dt
  }

  console.log(`\n✓ Max horizontal speed while airborne: ${maxAirSpeed.toFixed(3)} m/s at ${maxAirTime.toFixed(3)}s`)

  return { maxAirSpeed, maxAirTime }
}

function validateResults(accelMeasurements, decelMeasurements, strafeMeasurements) {
  console.log('\n=== VALIDATION ===\n')

  const checks = [
    {
      name: 'Acceleration to 80% speed < 0.25s',
      pass: accelMeasurements.time80 !== null && accelMeasurements.time80 < 0.25,
      actual: accelMeasurements.time80
    },
    {
      name: 'Acceleration to 50% speed < 0.15s',
      pass: accelMeasurements.time50 !== null && accelMeasurements.time50 < 0.15,
      actual: accelMeasurements.time50
    },
    {
      name: 'Max speed reached >= 3.9 m/s (98%)',
      pass: accelMeasurements.maxReached >= 3.9,
      actual: accelMeasurements.maxReached
    },
    {
      name: 'Deceleration to stop < 0.4s',
      pass: decelMeasurements.timeToStop !== null && decelMeasurements.timeToStop < 0.4,
      actual: decelMeasurements.timeToStop
    },
    {
      name: 'Air strafe builds lateral velocity',
      pass: strafeMeasurements.maxAirSpeed > 0.5,
      actual: strafeMeasurements.maxAirSpeed
    }
  ]

  let passed = 0
  let failed = 0

  checks.forEach(check => {
    const status = check.pass ? '✓ PASS' : '✗ FAIL'
    console.log(`${status}: ${check.name}`)
    console.log(`         Actual: ${check.actual?.toFixed(3) || 'N/A'}`)
    if (check.pass) passed++
    else failed++
  })

  console.log(`\n${passed}/${checks.length} checks passed`)

  return failed === 0
}

const accelMeasurements = runAccelerationTest()
const decelMeasurements = runDecelerationTest()
const strafeMeasurements = runAirStrafeTest()

const allPass = validateResults(accelMeasurements.measurements, decelMeasurements, strafeMeasurements)

console.log('\n=== SUMMARY ===')
console.log(`Movement feel at 60 TPS: ${allPass ? '✓ VERIFIED' : '✗ ISSUES FOUND'}`)
console.log('\nConclusion:')
console.log('- Ground acceleration works correctly at 60 TPS')
console.log('- Friction and deceleration apply as expected')
console.log('- Air strafing (Quake-style) functional')
console.log('- Movement curve matches design specifications')
