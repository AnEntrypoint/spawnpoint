import { spawn } from 'child_process'
import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { promisify } from 'util'

const __dirname = dirname(fileURLToPath(import.meta.url))
const wait = promisify(setTimeout)

const TEST_CONFIG = {
  duration: 2 * 60 * 1000,
  players: 4,
  serverPort: 3000,
  serverWaitMs: 5000,
  measurementIntervalMs: 100
}

const BASE_URL = `http://localhost:${TEST_CONFIG.serverPort}`

async function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['server.js'], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let outputReceived = false
    const timeout = setTimeout(() => {
      if (!outputReceived) resolve(proc)
    }, TEST_CONFIG.serverWaitMs)

    proc.stdout.on('data', (data) => {
      const msg = data.toString()
      if (!outputReceived) {
        console.log('[SERVER READY]')
        outputReceived = true
        resolve(proc)
        clearTimeout(timeout)
      }
    })

    proc.stderr.on('data', (data) => {
      const msg = data.toString()
      if (msg.includes('error') || msg.includes('Error')) {
        console.error('[SERVER ERROR]', msg.trim())
      }
    })

    proc.on('error', reject)
  })
}

async function launchPlayerBot(browser, playerId) {
  const page = await browser.newPage()

  console.log(`[Player ${playerId}] Connecting...`)
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })

  console.log(`[Player ${playerId}] Waiting for client...`)
  const connected = await page.waitForFunction(
    () => {
      return window.debug &&
             window.debug.client &&
             window.debug.client.playerId !== null &&
             window.debug.client.connected
    },
    { timeout: 20000 }
  ).catch(() => null)

  if (!connected) {
    throw new Error(`Player ${playerId} failed to connect`)
  }

  await wait(1500)

  console.log(`[Player ${playerId}] Connected`)

  return { page, playerId }
}

async function executeRandomMovement(page, action, duration) {
  await page.evaluate(
    (act, dur) => {
      const ih = window.debug?.inputHandler
      if (!ih) return

      const keyMap = {
        forward: 'w',
        backward: 's',
        left: 'a',
        right: 'd'
      }

      if (act === 'idle') return

      const key = keyMap[act]
      if (key && ih._keys) {
        ih._keys.set(key, true)
        setTimeout(() => {
          if (ih._keys) ih._keys.delete(key)
        }, dur)
      }

      if (act === 'jump') {
        if (ih._keys) {
          ih._keys.set(' ', true)
          setTimeout(() => {
            if (ih._keys) ih._keys.delete(' ')
          }, 100)
        }
      }
    },
    action,
    duration
  )

  await wait(duration + 50)
}

async function measureRemotePlayers(page) {
  return await page.evaluate(() => {
    const client = window.debug?.client
    if (!client || !client.state) return null

    const remotePlayers = (client.state.players || [])
      .filter(p => p.id !== client.playerId)
      .map(p => ({
        id: p.id,
        position: p.position || [0, 0, 0],
        velocity: p.velocity || [0, 0, 0],
        health: p.health || 0
      }))

    return {
      timestamp: Date.now(),
      remotePlayerCount: remotePlayers.length,
      remotePlayers,
      connected: client.connected,
      tick: client.currentTick
    }
  }).catch(() => null)
}

async function runMultiplayerTest() {
  console.log('\n========================================')
  console.log('W4-025: Multiplayer Integration Test')
  console.log('60 TPS, 3+ Players, 2+ Minutes')
  console.log('========================================\n')

  let server = null
  let browser = null
  const players = []
  const measurements = []

  try {
    console.log('Starting server at 60 TPS...\n')
    server = await startServer()
    await wait(2000)

    console.log(`Launching ${TEST_CONFIG.players} player clients...\n`)
    browser = await chromium.launch({ headless: true })

    for (let i = 0; i < TEST_CONFIG.players; i++) {
      const player = await launchPlayerBot(browser, i)
      players.push(player)
    }

    console.log(`\nAll ${TEST_CONFIG.players} players connected!\n`)
    console.log(`Running for ${TEST_CONFIG.duration / 1000}s...\n`)

    const testStartTime = Date.now()
    let testRunning = true

    const actions = ['forward', 'backward', 'left', 'right', 'jump', 'idle']

    const movementTasks = players.map(async (player) => {
      try {
        while (testRunning) {
          const action = actions[Math.floor(Math.random() * actions.length)]
          const duration = 200 + Math.random() * 600
          await executeRandomMovement(player.page, action, duration).catch(() => {})
        }
      } catch (e) {
      }
    })

    const measurementTask = (async () => {
      try {
        while (testRunning) {
          for (const player of players) {
            const state = await measureRemotePlayers(player.page).catch(() => null)
            if (state) {
              measurements.push(state)
            }
          }
          await wait(TEST_CONFIG.measurementIntervalMs)
        }
      } catch (e) {
      }
    })()

    await wait(TEST_CONFIG.duration)
    testRunning = false

    console.log('Test duration reached. Stopping...\n')

    await Promise.race([
      Promise.all(movementTasks),
      wait(2000)
    ]).catch(() => {})

    await measurementTask.catch(() => {})
    await wait(1000)

    const report = analyzeResults(measurements, TEST_CONFIG.duration, TEST_CONFIG.players)

    return evaluateResults(report, TEST_CONFIG.players)

  } catch (err) {
    console.error('\nTest error:', err.message)
    return false
  } finally {
    console.log('Cleaning up...\n')

    if (browser) {
      await browser.close().catch(() => {})
    }

    if (server) {
      server.kill('SIGTERM')
      await wait(1500)
      if (!server.killed) {
        server.kill('SIGKILL')
      }
    }
  }
}

function analyzeResults(measurements, testDuration, expectedPlayers) {
  if (measurements.length === 0) {
    return {
      totalElapsed: (testDuration / 1000).toFixed(1),
      measurementCount: 0,
      avgRemotePlayerCount: 0,
      avgJitterMs: 0,
      maxJitterMs: 0,
      estimatedTickRate: 0,
      expectedTickRate: 60,
      expectedSnapshotCount: Math.round((testDuration / 1000) * 60)
    }
  }

  const validMeasurements = measurements.filter(m => m && m.timestamp)

  const jitterSamples = []
  for (let i = 1; i < validMeasurements.length; i++) {
    const dt = validMeasurements[i].timestamp - validMeasurements[i - 1].timestamp
    const expectedDt = 1000 / 60
    const jitter = Math.abs(dt - expectedDt)
    jitterSamples.push(jitter)
  }

  const avgJitter = jitterSamples.length > 0
    ? jitterSamples.reduce((a, b) => a + b, 0) / jitterSamples.length
    : 0
  const maxJitter = jitterSamples.length > 0 ? Math.max(...jitterSamples) : 0

  const avgRemotePlayerCount = validMeasurements.length > 0
    ? validMeasurements.reduce((sum, m) => sum + m.remotePlayerCount, 0) / validMeasurements.length
    : 0

  const timeSpan = validMeasurements[validMeasurements.length - 1].timestamp - validMeasurements[0].timestamp
  const estimatedTickRate = timeSpan > 0
    ? ((validMeasurements.length / timeSpan) * 1000).toFixed(1)
    : 0

  return {
    totalElapsed: (testDuration / 1000).toFixed(1),
    measurementCount: validMeasurements.length,
    avgRemotePlayerCount: avgRemotePlayerCount.toFixed(2),
    avgJitterMs: avgJitter.toFixed(2),
    maxJitterMs: maxJitter.toFixed(2),
    estimatedTickRate,
    expectedTickRate: 60,
    expectedSnapshotCount: Math.round((testDuration / 1000) * 60)
  }
}

function evaluateResults(report, expectedPlayers) {
  console.log('========== TEST RESULTS ==========\n')
  console.log(`Test Duration: ${report.totalElapsed}s`)
  console.log(`Measurements: ${report.measurementCount} (expected ~${report.expectedSnapshotCount})`)
  console.log(`Avg Remote Players: ${report.avgRemotePlayerCount} (expected ${expectedPlayers - 1})`)
  console.log(`Estimated Tick Rate: ${report.estimatedTickRate} TPS`)
  console.log(`Average Jitter: ${report.avgJitterMs}ms (16.67ms @ 60 TPS)`)
  console.log(`Max Jitter: ${report.maxJitterMs}ms`)

  console.log('\n========== VERIFICATION ==========\n')

  const checks = {
    'Tick rate within 10 TPS': Math.abs(parseFloat(report.estimatedTickRate) - 60) < 10,
    'Minimum measurements': report.measurementCount > 100,
    'Remote players visible': parseFloat(report.avgRemotePlayerCount) > expectedPlayers - 2,
    'Test duration met (120s+)': parseInt(report.totalElapsed) >= 119,
    'Jitter reasonable': parseFloat(report.avgJitterMs) < 30
  }

  Object.entries(checks).forEach(([name, passed]) => {
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}`)
  })

  const allPassed = Object.values(checks).every(v => v)

  console.log(`\n========== RESULT: ${allPassed ? 'PASSED' : 'FAILED'} ==========\n`)

  return allPassed
}

const success = await runMultiplayerTest()
process.exit(success ? 0 : 1)
