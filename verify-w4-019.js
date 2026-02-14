#!/usr/bin/env node

/**
 * W4-019 Verification Script
 * Tests character movement acceleration at 60 TPS
 * Can be run with: node verify-w4-019.js
 */

import { applyMovement } from './src/shared/movement.js'

const CONFIG = {
  tickRate: 60,
  dt: 1/60,
  maxSpeed: 4.0,
  groundAccel: 10.0,
  airAccel: 1.0,
  friction: 6.0,
  stopSpeed: 2.0,
  jumpImpulse: 4.0
}

function createState() {
  return { velocity: [0, 0, 0], position: [0, 0, 0], onGround: true }
}

function runTests() {
  console.log('\nW4-019: Movement Acceleration Test at 60 TPS')
  console.log('============================================\n')

  const movement = {
    maxSpeed: CONFIG.maxSpeed,
    groundAccel: CONFIG.groundAccel,
    airAccel: CONFIG.airAccel,
    friction: CONFIG.friction,
    stopSpeed: CONFIG.stopSpeed,
    jumpImpulse: CONFIG.jumpImpulse
  }

  // TEST 1: ACCELERATION
  console.log('TEST 1: Ground Acceleration\n')
  const state1 = createState()
  const input1 = { forward: true, left: false, right: false, backward: false, yaw: 0, jump: false }

  let accelResults = { time50: null, time80: null, time90: null, maxSpeed: 0 }
  let time = 0

  for (let i = 0; i < 180; i++) {
    applyMovement(state1, input1, movement, CONFIG.dt)
    const speed = Math.sqrt(state1.velocity[0] ** 2 + state1.velocity[2] ** 2)

    if (accelResults.time50 === null && speed >= 2.0) accelResults.time50 = time
    if (accelResults.time80 === null && speed >= 3.2) accelResults.time80 = time
    if (accelResults.time90 === null && speed >= 3.6) accelResults.time90 = time
    if (speed > accelResults.maxSpeed) accelResults.maxSpeed = speed

    if (i % 20 === 0) console.log(`  [${i}] t=${time.toFixed(3)}s speed=${speed.toFixed(3)} m/s`)
    time += CONFIG.dt
  }

  console.log(`\nResults:`)
  console.log(`  Time to 50%: ${accelResults.time50?.toFixed(3) || 'N/A'}s`)
  console.log(`  Time to 80%: ${accelResults.time80?.toFixed(3) || 'N/A'}s`)
  console.log(`  Time to 90%: ${accelResults.time90?.toFixed(3) || 'N/A'}s`)
  console.log(`  Max speed: ${accelResults.maxSpeed.toFixed(3)} m/s`)
  console.log(`  Status: ${accelResults.maxSpeed >= 3.9 ? 'PASS' : 'FAIL'}`)

  // TEST 2: DECELERATION
  console.log('\n\nTEST 2: Deceleration\n')
  const state2 = createState()
  state2.velocity[0] = 4.0
  const input2 = { forward: false, left: false, right: false, backward: false, yaw: 0 }

  let decelResults = { timeToStop: null }
  time = 0

  for (let i = 0; i < 60; i++) {
    const speed = Math.sqrt(state2.velocity[0] ** 2 + state2.velocity[2] ** 2)
    if (decelResults.timeToStop === null && speed < 0.05) decelResults.timeToStop = time

    if (i % 10 === 0) console.log(`  [${i}] t=${time.toFixed(3)}s speed=${speed.toFixed(3)} m/s`)

    applyMovement(state2, input2, movement, CONFIG.dt)
    time += CONFIG.dt
  }

  console.log(`\nResults:`)
  console.log(`  Time to stop: ${decelResults.timeToStop?.toFixed(3) || 'N/A'}s`)
  console.log(`  Status: ${decelResults.timeToStop && decelResults.timeToStop < 0.4 ? 'PASS' : 'FAIL'}`)

  // TEST 3: AIR STRAFE
  console.log('\n\nTEST 3: Air Strafing\n')
  const state3 = createState()
  state3.velocity[1] = 4.0
  state3.onGround = false
  const input3 = { forward: true, left: true, right: false, backward: false, yaw: 0 }

  let strafeResults = { maxAirSpeed: 0 }
  time = 0

  for (let i = 0; i < 60; i++) {
    applyMovement(state3, input3, movement, CONFIG.dt)
    const horizSpeed = Math.sqrt(state3.velocity[0] ** 2 + state3.velocity[2] ** 2)

    if (horizSpeed > strafeResults.maxAirSpeed) strafeResults.maxAirSpeed = horizSpeed
    if (i % 10 === 0) console.log(`  [${i}] t=${time.toFixed(3)}s horizSpeed=${horizSpeed.toFixed(3)} m/s vy=${state3.velocity[1].toFixed(3)} m/s`)

    state3.velocity[1] -= 9.81 * CONFIG.dt
    time += CONFIG.dt
  }

  console.log(`\nResults:`)
  console.log(`  Max air speed: ${strafeResults.maxAirSpeed.toFixed(3)} m/s`)
  console.log(`  Status: ${strafeResults.maxAirSpeed > 0 ? 'PASS' : 'FAIL'}`)

  // FINAL REPORT
  console.log('\n\nFINAL REPORT')
  console.log('=============\n')

  const results = [
    { name: 'Acceleration to max', pass: accelResults.maxSpeed >= 3.9 },
    { name: 'Deceleration smooth', pass: decelResults.timeToStop && decelResults.timeToStop < 0.4 },
    { name: 'Air strafe works', pass: strafeResults.maxAirSpeed > 0 }
  ]

  const passed = results.filter(r => r.pass).length
  const total = results.length

  results.forEach(r => {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}`)
  })

  console.log(`\nTotal: ${passed}/${total} tests passed`)
  console.log(`Status: ${passed === total ? 'APPROVED FOR 60 TPS' : 'NEEDS INVESTIGATION'}`)
  console.log('\n')

  return passed === total
}

try {
  const success = runTests()
  process.exit(success ? 0 : 1)
} catch (err) {
  console.error('Test error:', err)
  process.exit(1)
}
