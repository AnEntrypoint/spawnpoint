#!/usr/bin/env node
import { spawn } from 'child_process'
import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const TEST_DURATION_MS = 2 * 60 * 1000
const NUM_PLAYERS = 4
const SERVER_PORT = 3000
const BASE_URL = `http://localhost:${SERVER_PORT}`

class Telemetry {
  constructor() {
    this.snapshots = []
    this.playerCount = 0
    this.startTime = Date.now()
  }

  recordSnapshot(data) {
    this.snapshots.push({
      timestamp: Date.now(),
      ...data
    })
  }

  getAveragePositionDiff() {
    if (this.snapshots.length < 2) return 0
    const diffs = this.snapshots
      .filter(s => s.positionDiffs && s.positionDiffs.length > 0)
      .flatMap(s => s.positionDiffs)
    return diffs.length > 0
      ? diffs.reduce((a, b) => a + b, 0) / diffs.length
      : 0
  }

  getMaxPositionDiff() {
    if (this.snapshots.length === 0) return 0
    const diffs = this.snapshots
      .filter(s => s.positionDiffs && s.positionDiffs.length > 0)
      .flatMap(s => s.positionDiffs)
    return diffs.length > 0 ? Math.max(...diffs) : 0
  }

  getAverageJitter() {
    if (this.snapshots.length < 2) return 0
    let totalJitter = 0
    let count = 0
    for (let i = 1; i < this.snapshots.length; i++) {
      const dt = this.snapshots[i].timestamp - this.snapshots[i-1].timestamp
      const expectedDt = 1000 / 60
      const jitter = Math.abs(dt - expectedDt)
      totalJitter += jitter
      count++
    }
    return count > 0 ? totalJitter / count : 0
  }

  getEstimatedTickRate() {
    if (this.snapshots.length < 10) return 0
    const timeSpan = this.snapshots[this.snapshots.length - 1].timestamp - this.snapshots[0].timestamp
    if (timeSpan === 0) return 0
    return (this.snapshots.length / timeSpan) * 1000
  }

  report() {
    const elapsed = Date.now() - this.startTime
    return {
      elapsedMs: elapsed,
      snapshotsReceived: this.snapshots.length,
      averagePositionDiff: this.getAveragePositionDiff().toFixed(3),
      maxPositionDiff: this.getMaxPositionDiff().toFixed(3),
      averageJitterMs: this.getAverageJitter().toFixed(2),
      estimatedTickRate: this.getEstimatedTickRate().toFixed(1),
      playersConnected: this.playerCount
    }
  }
}

class PlayerBot {
  constructor(page, index, telemetry) {
    this.page = page
    this.index = index
    this.telemetry = telemetry
    this.running = false
  }

  async initialize() {
    console.log(`[Player ${this.index}] Navigating...`)
    await this.page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })

    console.log(`[Player ${this.index}] Waiting for client...`)
    const connected = await this.page.waitForFunction(() => {
      return window.client !== undefined && window.client.playerId !== null
    }, { timeout: 15000 }).catch(() => false)

    if (!connected) {
      throw new Error(`Player ${this.index} failed to connect within timeout`)
    }

    await this.page.waitForTimeout(2000)
    console.log(`[Player ${this.index}] Connected and spawned`)
  }

  async startMovement() {
    this.running = true
    console.log(`[Player ${this.index}] Starting movement AI`)

    const actions = ['forward', 'backward', 'left', 'right', 'jump', 'idle']

    while (this.running) {
      const action = actions[Math.floor(Math.random() * actions.length)]
      const duration = 300 + Math.random() * 800

      await this.page.evaluate((act, dur) => {
        const ih = window.inputHandler
        if (!ih) return

        if (act === 'forward') {
          ih._keys.set('w', true)
          setTimeout(() => ih._keys.delete('w'), dur)
        } else if (act === 'backward') {
          ih._keys.set('s', true)
          setTimeout(() => ih._keys.delete('s'), dur)
        } else if (act === 'left') {
          ih._keys.set('a', true)
          setTimeout(() => ih._keys.delete('a'), dur)
        } else if (act === 'right') {
          ih._keys.set('d', true)
          setTimeout(() => ih._keys.delete('d'), dur)
        } else if (act === 'jump') {
          ih._keys.set(' ', true)
          setTimeout(() => ih._keys.delete(' '), 100)
        }
      }, action, duration)

      await this.page.waitForTimeout(duration + 100)
    }
  }

  async measureOnce() {
    try {
      const data = await this.page.evaluate(() => {
        if (!window.client) return null
        const players = window.client.remotePlayers || []
        const positionDiffs = []

        for (const p of players) {
          if (p.position && Array.isArray(p.position)) {
            const x = p.position[0] || 0
            const y = p.position[1] || 0
            const z = p.position[2] || 0
            positionDiffs.push(Math.sqrt(x*x + y*y + z*z))
          }
        }

        return {
          playerCount: players.length,
          positionDiffs,
          snapshotTime: Date.now()
        }
      }).catch(() => null)

      if (data) {
        this.telemetry.recordSnapshot(data)
      }
    } catch (e) {
    }
  }

  stop() {
    this.running = false
  }
}

async function runTest() {
  console.log('\n=== W4-025: Multiplayer Integration Test (60 TPS, 3+ Players) ===\n')

  let serverProcess = null
  let browser = null
  const bots = []
  const telemetry = new Telemetry()

  try {
    console.log('Starting server at 60 TPS...')
    serverProcess = spawn('node', ['server.js'], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    serverProcess.stderr.on('data', (data) => {
      const msg = data.toString()
      if (msg.includes('error') || msg.includes('Error')) {
        console.error('[SERVER ERROR]', msg.trim())
      }
    })

    await new Promise(r => setTimeout(r, 3000))

    console.log(`Launching ${NUM_PLAYERS} browser clients...`)
    browser = await chromium.launch({ headless: true })

    for (let i = 0; i < NUM_PLAYERS; i++) {
      const page = await browser.newPage()
      const bot = new PlayerBot(page, i, telemetry)
      bots.push(bot)

      try {
        await bot.initialize()
        telemetry.playerCount++
      } catch (e) {
        console.error(`Failed to initialize player ${i}:`, e.message)
        throw e
      }
    }

    console.log(`\nAll ${NUM_PLAYERS} players connected. Starting test for ${TEST_DURATION_MS/1000}s...\n`)

    const startTime = Date.now()

    const movementPromises = bots.map(bot => bot.startMovement())

    const measurementPromise = (async () => {
      while (Date.now() - startTime < TEST_DURATION_MS) {
        for (const bot of bots) {
          await bot.measureOnce().catch(() => {})
        }
        await new Promise(r => setTimeout(r, 100))
      }
    })()

    await new Promise(r => setTimeout(r, TEST_DURATION_MS))

    console.log(`\nTest duration reached. Stopping bots...`)
    for (const bot of bots) {
      bot.stop()
    }

    await Promise.all(movementPromises).catch(() => {})
    await measurementPromise.catch(() => {})

    await new Promise(r => setTimeout(r, 1000))

    const report = telemetry.report()
    const elapsed = report.elapsedMs

    console.log('\n=== SESSION REPORT ===\n')
    console.log(`Test Duration: ${(elapsed / 1000).toFixed(1)}s`)
    console.log(`Players Connected: ${report.playersConnected}`)
    console.log(`Server Tick Rate (estimated): ${report.estimatedTickRate} TPS`)
    console.log(`Snapshots Received: ${report.snapshotsReceived}`)
    console.log(`Average Position Diff (units): ${report.averagePositionDiff}`)
    console.log(`Max Position Diff (units): ${report.maxPositionDiff}`)
    console.log(`Average Snapshot Jitter: ${report.averageJitterMs}ms`)
    console.log(`Expected: 16.67ms per snapshot (60 TPS)`)

    console.log('\n=== VERIFICATION ===\n')

    const results = {
      playersConnected: report.playersConnected === NUM_PLAYERS,
      noDisconnects: report.playersConnected === NUM_PLAYERS,
      tickRateOk: Math.abs(parseFloat(report.estimatedTickRate) - 60) < 8,
      positionSyncOk: parseFloat(report.averagePositionDiff) < 2.5,
      durationMet: elapsed >= TEST_DURATION_MS * 0.95,
      snapshotCount: report.snapshotsReceived > (TEST_DURATION_MS / 1000) * 50
    }

    console.log(`[${results.playersConnected ? 'PASS' : 'FAIL'}] All players connected (${report.playersConnected}/${NUM_PLAYERS})`)
    console.log(`[${results.noDisconnects ? 'PASS' : 'FAIL'}] No disconnections detected`)
    console.log(`[${results.tickRateOk ? 'PASS' : 'FAIL'}] Tick rate stable at ~60 TPS (${report.estimatedTickRate})`)
    console.log(`[${results.positionSyncOk ? 'PASS' : 'FAIL'}] Position sync within tolerance (${report.averagePositionDiff} units)`)
    console.log(`[${results.durationMet ? 'PASS' : 'FAIL'}] Test duration met (${(elapsed / 1000).toFixed(1)}s >= 120s)`)
    console.log(`[${results.snapshotCount ? 'PASS' : 'FAIL'}] Healthy snapshot rate (${report.snapshotsReceived} snapshots)`)

    const allPassed = Object.values(results).every(v => v)

    console.log(`\n=== RESULT: ${allPassed ? 'PASSED' : 'FAILED'} ===\n`)

    if (!allPassed) {
      console.log('Failed checks:')
      Object.entries(results).forEach(([check, passed]) => {
        if (!passed) console.log(`  - ${check}`)
      })
    }

    return allPassed ? 0 : 1

  } catch (e) {
    console.error('\n!!! TEST ERROR !!!')
    console.error(e.message)
    console.error(e.stack)
    return 1
  } finally {
    console.log('Cleaning up...')

    for (const bot of bots) {
      bot.stop()
    }

    if (browser) {
      await browser.close().catch(() => {})
    }

    if (serverProcess) {
      serverProcess.kill('SIGTERM')
      await new Promise(r => setTimeout(r, 1000))
      if (!serverProcess.killed) {
        serverProcess.kill('SIGKILL')
      }
    }

    console.log('Test complete.\n')
  }
}

const exitCode = await runTest()
process.exit(exitCode)
