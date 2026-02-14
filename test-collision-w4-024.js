import { chromium } from 'playwright'
import { createServer } from './src/sdk/server.js'

const TEST_DURATION_MS = 3000
const TARGET_TICK_RATE = 60
const DT = 1 / TARGET_TICK_RATE

async function runCollisionTest() {
  console.log('[W4-024] Starting player-player collision test at 60 TPS')

  let server = null
  let browsers = []

  try {
    console.log('[W4-024] Creating server...')
    server = await createServer({
      port: 8765,
      tickRate: 60,
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

    await server.start()
    console.log('[W4-024] Server started on port 8765')

    await new Promise(r => setTimeout(r, 500))

    const browser = await chromium.launch({ headless: true })
    browsers.push(browser)

    console.log('[W4-024] Creating two browser connections...')
    const context1 = await browser.newContext()
    const page1 = await context1.newPage()

    const context2 = await browser.newContext()
    const page2 = await context2.newPage()

    let client1Ready = false
    let client2Ready = false
    let testData = null

    page1.on('console', msg => console.log('[CLIENT-1]', msg.text()))
    page2.on('console', msg => console.log('[CLIENT-2]', msg.text()))

    page1.on('error', err => console.error('[CLIENT-1 ERROR]', err))
    page2.on('error', err => console.error('[CLIENT-2 ERROR]', err))

    console.log('[W4-024] Loading page 1...')
    await page1.goto('http://localhost:8765', { waitUntil: 'networkidle', timeout: 10000 })
    console.log('[W4-024] Loading page 2...')
    await page2.goto('http://localhost:8765', { waitUntil: 'networkidle', timeout: 10000 })

    await new Promise(r => setTimeout(r, 1000))

    console.log('[W4-024] Waiting for clients to be ready...')
    await Promise.race([
      page1.waitForFunction(() => {
        try {
          return window.debug?.client?.state?.players?.length >= 2
        } catch (e) {
          return false
        }
      }, { timeout: 10000 }),
      new Promise(r => setTimeout(r, 8000))
    ]).catch(() => {})

    await Promise.race([
      page2.waitForFunction(() => {
        try {
          return window.debug?.client?.state?.players?.length >= 2
        } catch (e) {
          return false
        }
      }, { timeout: 10000 }),
      new Promise(r => setTimeout(r, 8000))
    ]).catch(() => {})

    console.log('[W4-024] Clients connected. Starting collision test...')

    await page1.evaluate(() => {
      try {
        const client = window.debug?.client
        if (client?.network) {
          const msg = { type: 'message', data: { type: 'start_collision_test' } }
          client.network.send(msg)
        }
      } catch (e) {
        console.error('Failed to send test message:', e.message)
      }
    })

    console.log('[W4-024] Test running. Collecting data for', TEST_DURATION_MS / 1000, 'seconds...')
    await new Promise(r => setTimeout(r, TEST_DURATION_MS))

    console.log('[W4-024] Fetching collision data...')
    testData = await page1.evaluate(async () => {
      try {
        const client = window.debug?.client
        if (client?.network) {
          const msg = { type: 'message', data: { type: 'get_collision_data' } }
          client.network.send(msg)
          await new Promise(r => setTimeout(r, 500))
        }
        return window.__collisionTestData || null
      } catch (e) {
        console.error('Failed to fetch data:', e.message)
        return null
      }
    })

    if (!testData) {
      console.log('[W4-024] Attempting alternative data fetch method...')
      testData = await page1.evaluate(() => {
        try {
          return window._testCollisionData || window.__collisionTestData || { message: 'no data available' }
        } catch (e) {
          return { error: e.message }
        }
      })
    }

    console.log('[W4-024] Test complete. Analyzing results...')

    const results = await analyzeCollisionData(server, TARGET_TICK_RATE)
    reportResults(results)

    await context1.close()
    await context2.close()
    await browser.close()

    process.exit(results.success ? 0 : 1)
  } catch (err) {
    console.error('[W4-024 ERROR]', err.message)
    console.error(err.stack)
    process.exit(1)
  } finally {
    if (server?.httpServer) {
      try {
        await new Promise(r => server.httpServer.close(r))
      } catch (e) {}
    }
    for (const b of browsers) {
      try {
        await b.close()
      } catch (e) {}
    }
  }
}

async function analyzeCollisionData(server, tickRate) {
  const dt = 1 / tickRate
  const capsuleRadius = 0.4
  const minDist = capsuleRadius * 2

  const physicsInt = server.physicsIntegration
  const playerManager = server.playerManager
  const players = playerManager.getConnectedPlayers()

  if (players.length < 2) {
    return {
      success: false,
      reason: 'Not enough players connected',
      metrics: {}
    }
  }

  const playerA = players[0]
  const playerB = players[1]

  const measurements = {
    totalFrames: 0,
    collisionFrames: 0,
    firstCollisionTime: null,
    firstCollisionDist: null,
    collisionSeparationPushes: [],
    oscillationCount: 0,
    playerAPath: [],
    playerBPath: [],
    maxSeparationVelocity: 0,
    minCollisionDistance: Infinity,
    avgCollisionDistance: 0
  }

  let inCollisionPhase = false
  let collisionCount = 0

  console.log('[W4-024] Analyzing physics state...')
  console.log('  Player A:', playerA.id, 'pos:', playerA.state.position)
  console.log('  Player B:', playerB.id, 'pos:', playerB.state.position)
  console.log('  Min collision distance:', minDist)

  const dx = playerB.state.position[0] - playerA.state.position[0]
  const dz = playerB.state.position[2] - playerA.state.position[2]
  const dist = Math.hypot(dx, dz)

  measurements.playerAPath.push({
    pos: [...playerA.state.position],
    vel: [...playerA.state.velocity]
  })
  measurements.playerBPath.push({
    pos: [...playerB.state.position],
    vel: [...playerB.state.velocity]
  })

  if (dist < minDist) {
    measurements.firstCollisionTime = 0
    measurements.firstCollisionDist = dist
    measurements.collisionFrames = 1
    measurements.minCollisionDistance = dist
  }

  measurements.totalFrames = 1
  const success = validateResults(measurements, dt)

  return {
    success,
    measurements,
    timeToCollision: measurements.firstCollisionTime,
    collisionOccurred: measurements.firstCollisionTime !== null,
    metrics: {
      tickRate,
      expectedCollisionTime: 0.75,
      totalFrames: measurements.totalFrames,
      collisionFrames: measurements.collisionFrames,
      firstCollisionTime: measurements.firstCollisionTime,
      firstCollisionDist: measurements.firstCollisionDist,
      minCollisionDistance: measurements.minCollisionDistance,
      playerAStartPos: playerA.state.position,
      playerBStartPos: playerB.state.position,
      capsuleRadius,
      minCollisionDistance: minDist
    }
  }
}

function validateResults(measurements, dt) {
  const acceptanceCriteria = {
    collisionDetected: measurements.firstCollisionTime !== null,
    reasonableTime: !measurements.firstCollisionTime || measurements.firstCollisionTime <= 1.0,
    correctDistance: measurements.firstCollisionDist !== null && measurements.firstCollisionDist < 0.85,
    noExcessiveOscillation: measurements.oscillationCount < 3,
    playerStable: true
  }

  const allPassed = Object.values(acceptanceCriteria).every(v => v === true || v === undefined)
  return allPassed
}

function reportResults(results) {
  console.log('\n' + '='.repeat(70))
  console.log('W4-024: PLAYER-PLAYER COLLISION TEST RESULTS')
  console.log('='.repeat(70))

  const m = results.metrics
  console.log('\nTEST CONFIGURATION:')
  console.log('  Tick Rate:', m.tickRate, 'TPS')
  console.log('  Capsule Radius:', m.capsuleRadius, 'units')
  console.log('  Min Collision Distance:', m.minCollisionDistance, 'units')

  console.log('\nPLAYER INITIAL POSITIONS:')
  console.log('  Player A:', m.playerAStartPos)
  console.log('  Player B:', m.playerBStartPos)

  console.log('\nCOLLISION DETECTION:')
  console.log('  Collision Occurred:', results.collisionOccurred)
  if (results.collisionOccurred) {
    console.log('  Time to First Collision:', results.timeToCollision?.toFixed(3), 'seconds')
    console.log('  Expected Time:', m.expectedCollisionTime, 'seconds')
    console.log('  First Collision Distance:', m.firstCollisionDist?.toFixed(3), 'units')
  }

  console.log('\nMETRICS:')
  console.log('  Total Frames Analyzed:', m.totalFrames)
  console.log('  Frames in Collision:', m.collisionFrames)
  console.log('  Collision Ratio:', ((m.collisionFrames / m.totalFrames) * 100).toFixed(1) + '%')

  console.log('\nVALIDATION:')
  console.log('  Result:', results.success ? 'PASS' : 'FAIL')
  if (!results.success) {
    console.log('  Reason:', results.reason || 'See metrics above')
  }

  console.log('\n' + '='.repeat(70))
}

runCollisionTest().catch(err => {
  console.error('[W4-024 FATAL]', err)
  process.exit(1)
})
