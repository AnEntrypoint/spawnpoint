#!/usr/bin/env node
import { TickSystem } from './src/netcode/TickSystem.js'

const TEST_DURATION_MS = 10000
const EXPECTED_TICK_INTERVAL_MS = 1000 / 60
const TOLERANCE_MS = 2

console.log('[TEST] TickSystem 60 TPS Verification')
console.log(`[TEST] Expected interval: ${EXPECTED_TICK_INTERVAL_MS.toFixed(2)}ms`)
console.log(`[TEST] Test duration: ${TEST_DURATION_MS}ms`)
console.log('')

const tickSystem = new TickSystem(60)

let tickCount = 0
let lastTickTime = 0
const tickTimestamps = []
const tickDurations = []

tickSystem.onTick((tick, dt) => {
  const now = Date.now()
  tickTimestamps.push(now)
  tickCount++

  if (tickCount > 1) {
    const interval = now - lastTickTime
    tickDurations.push(interval)
  }
  lastTickTime = now

  if (tickCount % 60 === 0) {
    const elapsed = now - tickTimestamps[0]
    process.stdout.write(`\r[TICK] ${tickCount} | Elapsed: ${elapsed}ms`)
  }
})

const startTime = Date.now()
tickSystem.start()

await new Promise(resolve => {
  setTimeout(() => {
    tickSystem.stop()
    resolve()
  }, TEST_DURATION_MS)
})

const endTime = Date.now()
const actualDuration = endTime - startTime

console.log('')
console.log('')
console.log('=== TEST RESULTS ===')
console.log(`Total ticks: ${tickCount}`)
console.log(`Actual duration: ${actualDuration}ms`)
console.log(`Expected duration: ${TEST_DURATION_MS}ms`)
console.log(`Intervals collected: ${tickDurations.length}`)
console.log('')

if (tickDurations.length > 0) {
  const avgInterval = tickDurations.reduce((a, b) => a + b, 0) / tickDurations.length
  const minInterval = Math.min(...tickDurations)
  const maxInterval = Math.max(...tickDurations)
  const variance = tickDurations.map(d => Math.pow(d - avgInterval, 2)).reduce((a, b) => a + b, 0) / tickDurations.length
  const stdDev = Math.sqrt(variance)

  console.log(`Average interval: ${avgInterval.toFixed(2)}ms (target: ${EXPECTED_TICK_INTERVAL_MS.toFixed(2)}ms)`)
  console.log(`Min interval: ${minInterval}ms`)
  console.log(`Max interval: ${maxInterval}ms`)
  console.log(`Std deviation: ${stdDev.toFixed(2)}ms`)
  console.log('')

  const deviation = Math.abs(avgInterval - EXPECTED_TICK_INTERVAL_MS)
  const passInterval = deviation <= TOLERANCE_MS
  console.log(`[CHECK] Avg interval: ${passInterval ? 'PASS' : 'FAIL'} (±${deviation.toFixed(2)}ms)`)

  let outliers = 0
  for (const interval of tickDurations) {
    if (Math.abs(interval - EXPECTED_TICK_INTERVAL_MS) > TOLERANCE_MS * 3) {
      outliers++
    }
  }
  console.log(`[CHECK] Outliers (>±${(TOLERANCE_MS * 3).toFixed(1)}ms): ${outliers}/${tickDurations.length}`)

  const expectedTickCount = Math.floor(actualDuration / EXPECTED_TICK_INTERVAL_MS)
  const tickCountDeviation = Math.abs(tickCount - expectedTickCount)
  console.log(`[CHECK] Tick count: ${tickCount}/${expectedTickCount} (deviation: ${tickCountDeviation})`)

  const tickCountPass = tickCountDeviation <= 2
  console.log(`[CHECK] Tick count: ${tickCountPass ? 'PASS' : 'FAIL'}`)
  console.log('')

  console.log('=== FIRST 20 TICK INTERVALS ===')
  for (let i = 0; i < Math.min(20, tickDurations.length); i++) {
    const interval = tickDurations[i]
    const diff = interval - EXPECTED_TICK_INTERVAL_MS
    const diffStr = diff >= 0 ? `+${diff.toFixed(2)}` : `${diff.toFixed(2)}`
    const marker = Math.abs(diff) <= TOLERANCE_MS ? '' : ' <-- OUT OF TOLERANCE'
    console.log(`  [${String(i+2).padStart(4)}] ${interval.toFixed(2)}ms (${diffStr}ms)${marker}`)
  }

  console.log('')
  console.log('=== VERDICT ===')
  const allPass = passInterval && tickCountPass && outliers === 0
  if (allPass) {
    console.log('[PASS] TickSystem 60 TPS working correctly')
  } else {
    console.log('[PARTIAL] Some metrics out of spec - see details')
  }
}

process.exit(0)
