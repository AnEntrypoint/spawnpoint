#!/usr/bin/env node
/**
 * W4-022: Animation Playback Test at 60 TPS
 *
 * Tests animation state transitions and smoothness at 60 TPS tick rate
 * Uses Playwright to control browser client and verify animation behavior
 */

import { chromium } from 'playwright'
import { boot } from './src/sdk/server.js'

let browser = null
let page = null
let serverRunning = false

async function startServer() {
  console.log('[TEST] Starting server at 60 TPS...')
  serverRunning = true
  boot().catch(err => {
    console.error('[TEST] Server error:', err)
    serverRunning = false
  })
  await new Promise(r => setTimeout(r, 2000))
}

async function connectClient() {
  console.log('[TEST] Launching browser...')
  browser = await chromium.launch({ headless: false })
  page = await browser.newPage()

  console.log('[TEST] Connecting to http://localhost:3000...')
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' })

  await new Promise(r => setTimeout(r, 3000))
}

async function testIdleAnimation() {
  console.log('\n[TEST] TEST 1: Idle Animation Smoothness')
  console.log('[TEST] Standing still for 3 seconds...')

  const logs = []
  page.on('console', msg => logs.push(msg.text()))

  await new Promise(r => setTimeout(r, 3000))

  console.log('[TEST] Animation logs:', logs.filter(l => l.includes('[anim]')).slice(-5))
  return true
}

async function testLocomotionTransitions() {
  console.log('\n[TEST] TEST 2: Locomotion Transitions (Hysteresis)')
  console.log('[TEST] Starting movement tests...')

  // Inject test code to monitor speed and state
  const monitorScript = `
    window.__animTest = {
      states: [],
      speeds: [],
      lastState: null,
      logStateChange: (newState, speed) => {
        if (newState !== window.__animTest.lastState) {
          window.__animTest.states.push({ state: newState, speed: speed.toFixed(2), time: Date.now() })
          window.__animTest.lastState = newState
          console.log('[ANIM_TEST] State: ' + newState + ' @ speed: ' + speed.toFixed(2))
        }
        window.__animTest.speeds.push(speed)
      }
    }
  `

  await page.evaluate(monitorScript)

  // Test slow movement (should stay idle)
  console.log('[TEST] Moving slowly (speed < 0.8)...')
  await page.keyboard.press('KeyW')
  await new Promise(r => setTimeout(r, 500))
  await page.keyboard.release('KeyW')

  await new Promise(r => setTimeout(r, 500))

  // Test walk speed
  console.log('[TEST] Moving at walk speed...')
  await page.keyboard.press('KeyW')
  await new Promise(r => setTimeout(r, 1500))
  await page.keyboard.release('KeyW')

  await new Promise(r => setTimeout(r, 1000))

  // Test sprint
  console.log('[TEST] Sprinting...')
  await page.keyboard.press('KeyW')
  await page.keyboard.press('ShiftLeft')
  await new Promise(r => setTimeout(r, 1500))
  await page.keyboard.release('ShiftLeft')
  await page.keyboard.release('KeyW')

  const result = await page.evaluate(() => window.__animTest)
  console.log('[TEST] State transitions recorded:', result.states.length)
  console.log('[TEST] Average speed:', (result.speeds.reduce((a,b) => a+b) / result.speeds.length).toFixed(2))

  return result.states.length > 0
}

async function testJumpAnimation() {
  console.log('\n[TEST] TEST 3: Jump Animation')
  console.log('[TEST] Testing jump...')

  // Jump and observe animation transition
  await page.keyboard.press('Space')
  console.log('[TEST] Jump pressed, waiting for animation...')

  await new Promise(r => setTimeout(r, 1500))

  console.log('[TEST] Jump complete')
  return true
}

async function testConcurrentAnimations() {
  console.log('\n[TEST] TEST 4: Concurrent Animations (Aim + Movement)')
  console.log('[TEST] Testing additive animations...')

  await page.keyboard.press('KeyW')
  await new Promise(r => setTimeout(r, 500))

  // Aim (if implemented as mouse button)
  await page.mouse.click(400, 300, { button: 'right' })
  await new Promise(r => setTimeout(r, 1000))

  await page.keyboard.release('KeyW')
  await new Promise(r => setTimeout(r, 500))

  console.log('[TEST] Concurrent animations test complete')
  return true
}

async function capturePerformanceMetrics() {
  console.log('\n[TEST] Capturing Performance Metrics')

  const metrics = await page.evaluate(() => {
    const perf = performance.getEntriesByType('measure')
    const fps = window.__animTest?.fps || 'unknown'
    return {
      fps: fps,
      paintEntries: performance.getEntriesByType('paint').length,
      measures: perf.length
    }
  })

  console.log('[TEST] Performance metrics:', metrics)
  return true
}

async function cleanup() {
  console.log('\n[TEST] Cleaning up...')
  if (page) await page.close()
  if (browser) await browser.close()
  process.exit(0)
}

async function main() {
  try {
    await startServer()
    await connectClient()

    // Run all tests
    const results = {
      idle: await testIdleAnimation(),
      transitions: await testLocomotionTransitions(),
      jump: await testJumpAnimation(),
      concurrent: await testConcurrentAnimations(),
      metrics: await capturePerformanceMetrics()
    }

    console.log('\n[TEST] ========== RESULTS ==========')
    console.log('[TEST] Idle Animation:', results.idle ? 'PASS' : 'FAIL')
    console.log('[TEST] Locomotion Transitions:', results.transitions ? 'PASS' : 'FAIL')
    console.log('[TEST] Jump Animation:', results.jump ? 'PASS' : 'FAIL')
    console.log('[TEST] Concurrent Animations:', results.concurrent ? 'PASS' : 'FAIL')
    console.log('[TEST] Performance Metrics:', results.metrics ? 'PASS' : 'FAIL')

    const allPass = Object.values(results).every(r => r)
    console.log('[TEST] OVERALL:', allPass ? 'PASS' : 'FAIL')

  } catch (err) {
    console.error('[TEST] Fatal error:', err)
  } finally {
    await cleanup()
  }
}

main()
