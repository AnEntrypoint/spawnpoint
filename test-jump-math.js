#!/usr/bin/env node

const TICK_RATE = 60
const DT = 1 / TICK_RATE
const GRAVITY = -9.81
const JUMP_IMPULSE = 4.0

console.log('=== PURE JUMP PHYSICS TEST (60 TPS) ===\n')
console.log(`Tick rate: ${TICK_RATE} TPS`)
console.log(`Tick duration: ${(DT * 1000).toFixed(2)}ms`)
console.log(`Jump impulse: ${JUMP_IMPULSE} m/s`)
console.log(`Gravity: ${GRAVITY} m/s²\n`)

const expectedHeight = (JUMP_IMPULSE * JUMP_IMPULSE) / (2 * Math.abs(GRAVITY))
const expectedApexTime = JUMP_IMPULSE / Math.abs(GRAVITY)
const expectedHangTime = 2 * expectedApexTime

console.log('Expected physics:')
console.log(`  Jump height: ${expectedHeight.toFixed(4)}m`)
console.log(`  Apex time: ${(expectedApexTime * 1000).toFixed(1)}ms (${(expectedApexTime / DT).toFixed(2)} ticks)`)
console.log(`  Hang time: ${(expectedHangTime * 1000).toFixed(1)}ms (${(expectedHangTime / DT).toFixed(2)} ticks)\n`)

const positions = []
const velocities = []
const times = []

let pos = 0
let vy = 0
let tick = 0
let jumpTick = 5
let apexTick = null
let landingTick = null

console.log('Simulation:')

while (tick < 100) {
  const timeMs = tick * (1000 / TICK_RATE)

  if (tick === jumpTick) {
    vy = JUMP_IMPULSE
    console.log(`  Tick ${tick.toString().padStart(3)} (${timeMs.toFixed(1).padStart(6)}ms): JUMP - vy set to ${vy.toFixed(3)} m/s`)
  }

  vy += GRAVITY * DT
  pos += vy * DT

  positions.push(pos)
  velocities.push(vy)
  times.push(timeMs)

  if (apexTick === null && vy <= 0.05 && tick > jumpTick) {
    apexTick = tick
    console.log(`  Tick ${tick.toString().padStart(3)} (${timeMs.toFixed(1).padStart(6)}ms): APEX - y=${pos.toFixed(4)}m, vy=${vy.toFixed(3)} m/s`)
  }

  if (apexTick !== null && pos <= 0 && landingTick === null) {
    landingTick = tick
    console.log(`  Tick ${tick.toString().padStart(3)} (${timeMs.toFixed(1).padStart(6)}ms): LANDING - y=${pos.toFixed(4)}m`)
  }

  if (tick <= 6 || (tick >= jumpTick - 1 && tick <= jumpTick + 30)) {
    const marker = tick === jumpTick ? ' [JUMP]' :
                   tick === apexTick ? ' [APEX]' :
                   tick === landingTick ? ' [LAND]' : ''
    console.log(`    y=${pos.toFixed(4)}m vy=${vy.toFixed(3)}m/s${marker}`)
  }

  tick++

  if (landingTick !== null && tick > landingTick + 5) break
}

console.log('\nMeasurements:')
const maxHeight = Math.max(...positions)
const apexTimeMs = times[apexTick] || 0
const jumpTimeMs = times[jumpTick]
const landingTimeMs = times[landingTick] || 0

console.log(`  Max height: ${maxHeight.toFixed(4)}m`)
console.log(`  Apex at tick ${apexTick} (${apexTimeMs.toFixed(1)}ms)`)
console.log(`  Landing at tick ${landingTick} (${landingTimeMs.toFixed(1)}ms)`)

const actualApexTime = apexTimeMs - jumpTimeMs
const actualHangTime = landingTimeMs - jumpTimeMs

console.log('\nComparison:')
console.log(`  Height: ${maxHeight.toFixed(4)}m vs ${expectedHeight.toFixed(4)}m expected (${((maxHeight - expectedHeight) / expectedHeight * 100).toFixed(2)}%)`)
console.log(`  Apex time: ${actualApexTime.toFixed(1)}ms vs ${(expectedApexTime * 1000).toFixed(1)}ms expected (${(actualApexTime - expectedApexTime * 1000).toFixed(1)}ms diff)`)
console.log(`  Hang time: ${actualHangTime.toFixed(1)}ms vs ${(expectedHangTime * 1000).toFixed(1)}ms expected (${(actualHangTime - expectedHangTime * 1000).toFixed(1)}ms diff)`)

console.log('\nAcceptance check:')
const heightOk = Math.abs(maxHeight - expectedHeight) / expectedHeight <= 0.05
const apexOk = Math.abs(actualApexTime - expectedApexTime * 1000) <= 50
const hangOk = Math.abs(actualHangTime - expectedHangTime * 1000) <= 100

console.log(`  ${heightOk ? '✓' : '✗'} Height within 5% tolerance`)
console.log(`  ${apexOk ? '✓' : '✗'} Apex time within 50ms`)
console.log(`  ${hangOk ? '✓' : '✗'} Hang time within 100ms`)

const allOk = heightOk && apexOk && hangOk
console.log(`\n${allOk ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`)

process.exit(allOk ? 0 : 1)
