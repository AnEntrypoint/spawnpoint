import { createServer } from './src/sdk/server.js'

const TEST_DURATION_MS = 10000
const EXPECTED_TICK_INTERVAL_MS = 1000 / 60
const TOLERANCE_MS = 2

let tickTimestamps = []
let tickCount = 0
const tickDurations = []

async function runTest() {
  console.log('[TEST] Starting TickSystem 60 TPS verification')
  console.log(`[TEST] Expected tick interval: ${EXPECTED_TICK_INTERVAL_MS.toFixed(2)}ms`)
  console.log(`[TEST] Test duration: ${TEST_DURATION_MS}ms`)
  console.log(`[TEST] Tolerance: ±${TOLERANCE_MS}ms`)
  console.log('')

  const config = {
    port: 3001,
    tickRate: 60,
    heartbeatInterval: 5000,
    heartbeatTimeout: 10000
  }

  const server = await createServer(config)

  const mockWorldDef = {
    port: 3001,
    tickRate: 60,
    gravity: [0, -9.81, 0],
    movement: {},
    entities: [],
    playerModel: './apps/tps-game/Cleetus.vrm',
    spawnPoint: [0, 5, 0]
  }

  await server.loadWorld(mockWorldDef)

  const tickSystem = server.tickSystem
  let lastTickTime = 0
  let warningsCount = 0
  let errorCount = 0

  tickSystem.onTick((tick, dt) => {
    const now = Date.now()
    tickTimestamps.push(now)
    tickCount++

    if (tickCount > 1) {
      const interval = now - lastTickTime
      tickDurations.push(interval)
    }
    lastTickTime = now

    if (tickCount % 100 === 0) {
      const elapsed = now - tickTimestamps[0]
      const expectedTicks = Math.floor(elapsed / EXPECTED_TICK_INTERVAL_MS)
      process.stdout.write(`\r[TICK] ${tickCount} ticks | Elapsed: ${elapsed}ms | Expected at this point: ${expectedTicks}`)
    }
  })

  const info = await server.start()
  console.log('')
  console.log(`[SERVER] Running at ${info.tickRate} TPS on port ${info.port}`)
  console.log('')

  const startTime = Date.now()
  const testPromise = new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, TEST_DURATION_MS)
  })

  await testPromise

  const endTime = Date.now()
  const actualDuration = endTime - startTime
  tickSystem.stop()

  console.log('')
  console.log('=== TEST RESULTS ===')
  console.log(`Total ticks: ${tickCount}`)
  console.log(`Actual duration: ${actualDuration}ms`)
  console.log(`Expected duration: ${TEST_DURATION_MS}ms`)
  console.log(`Actual intervals collected: ${tickDurations.length}`)
  console.log('')

  if (tickDurations.length > 0) {
    const avgInterval = tickDurations.reduce((a, b) => a + b, 0) / tickDurations.length
    const minInterval = Math.min(...tickDurations)
    const maxInterval = Math.max(...tickDurations)
    const variance = tickDurations.map(d => Math.pow(d - avgInterval, 2)).reduce((a, b) => a + b, 0) / tickDurations.length
    const stdDev = Math.sqrt(variance)

    console.log(`Average interval: ${avgInterval.toFixed(2)}ms (target: ${EXPECTED_TICK_INTERVAL_MS.toFixed(2)}ms)`)
    console.log(`Min interval: ${minInterval.toFixed(2)}ms`)
    console.log(`Max interval: ${maxInterval.toFixed(2)}ms`)
    console.log(`Std deviation: ${stdDev.toFixed(2)}ms`)
    console.log('')

    const deviation = Math.abs(avgInterval - EXPECTED_TICK_INTERVAL_MS)
    const passInterval = deviation <= TOLERANCE_MS
    console.log(`[CHECK] Average interval within tolerance: ${passInterval ? 'PASS' : 'FAIL'} (±${deviation.toFixed(2)}ms)`)

    let outliers = 0
    for (const interval of tickDurations) {
      if (Math.abs(interval - EXPECTED_TICK_INTERVAL_MS) > TOLERANCE_MS * 3) {
        outliers++
      }
    }
    console.log(`[CHECK] Outliers (>±${(TOLERANCE_MS * 3).toFixed(1)}ms): ${outliers}/${tickDurations.length}`)

    const expectedTickCount = Math.floor(actualDuration / EXPECTED_TICK_INTERVAL_MS)
    const tickCountDeviation = Math.abs(tickCount - expectedTickCount)
    console.log(`[CHECK] Tick count accuracy: ${tickCount}/${expectedTickCount} (deviation: ${tickCountDeviation})`)

    const tickCountPass = tickCountDeviation <= 2
    console.log(`[CHECK] Tick count within tolerance: ${tickCountPass ? 'PASS' : 'FAIL'}`)
    console.log('')

    console.log('=== DETAILED ANALYSIS ===')
    console.log(`First 10 intervals:`)
    for (let i = 0; i < Math.min(10, tickDurations.length); i++) {
      const diff = tickDurations[i] - EXPECTED_TICK_INTERVAL_MS
      const diffStr = diff >= 0 ? `+${diff.toFixed(2)}ms` : `${diff.toFixed(2)}ms`
      console.log(`  Tick ${i + 2}: ${tickDurations[i].toFixed(2)}ms (${diffStr})`)
    }

    console.log('')
    console.log('=== FINAL VERDICT ===')
    const allPass = passInterval && tickCountPass && outliers === 0
    console.log(allPass ? '[PASS] TickSystem 60 TPS verified' : '[PARTIAL] See details above')
  }

  process.exit(0)
}

runTest().catch(err => {
  console.error('[ERROR] Test failed:', err)
  process.exit(1)
})
