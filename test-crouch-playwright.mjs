import { chromium } from 'playwright'
import { createServer } from './src/sdk/server.js'

let browser, page, server

const tests = {
  crouchEngagement: false,
  crouchedMovement: false,
  uncrouchInOpen: false,
  rapidTransitions: false,
  noClipping: false
}

async function startServer() {
  console.log('Starting server at 60 TPS...')
  const worldMod = await import('./apps/world/index.js?t=' + Date.now())
  const worldDef = worldMod.default

  server = await createServer({
    port: 8080,
    tickRate: 60
  })

  await server.loadWorld(worldDef)
  const info = await server.start()
  console.log(`Server started at ${info.port} @ ${info.tickRate} TPS\n`)
  return info
}

async function setupBrowser() {
  console.log('Starting browser...')
  browser = await chromium.launch({ headless: false })
  page = await browser.newPage()

  // Expose server API to browser
  await page.evaluateHandle(() => {
    window.testResults = {}
  })

  await page.goto('http://localhost:8080')
  console.log('Browser loaded\n')
  return page
}

async function waitForPlayer() {
  console.log('Waiting for player to spawn...')
  return await page.evaluate(() => {
    return new Promise((resolve) => {
      let checks = 0
      const checkInterval = setInterval(() => {
        if (window.debug?.client?.localPlayer?.id) {
          clearInterval(checkInterval)
          resolve(window.debug.client.localPlayer.id)
        }
        checks++
        if (checks > 200) { // 10 seconds
          clearInterval(checkInterval)
          resolve(null)
        }
      }, 50)
    })
  })
}

async function test1_CrouchEngagement() {
  console.log('\n--- Test 1: Crouch Engagement ---')

  const result = await page.evaluate(async () => {
    const player = window.debug.client.localPlayer
    if (!player?.controller) {
      console.log('✗ No player controller')
      return false
    }

    const positionBefore = { ...player.position }
    console.log(`  Standing Y: ${positionBefore.y?.toFixed(3)}`)

    // Simulate crouch input
    player.controller.crouching = true

    // Wait for next tick
    await new Promise(r => setTimeout(r, 100))

    const positionAfter = { ...player.position }
    console.log(`  Crouched Y: ${positionAfter.y?.toFixed(3)}`)

    const yDiff = positionBefore.y - positionAfter.y
    console.log(`  Y change: ${yDiff?.toFixed(3)} units`)

    const result = yDiff > 0.05
    console.log(`  Result: ${result ? '✓ PASS' : '✗ FAIL'}`)
    return result
  })

  tests.crouchEngagement = result
  return result
}

async function test2_CrouchedMovement() {
  console.log('\n--- Test 2: Movement While Crouched ---')

  const result = await page.evaluate(async () => {
    const player = window.debug.client.localPlayer
    if (!player?.controller) {
      console.log('✗ No player controller')
      return false
    }

    // Ensure crouched
    player.controller.crouching = true
    await new Promise(r => setTimeout(r, 100))

    const posBefore = { ...player.position }
    console.log(`  Before move: (${posBefore.x?.toFixed(2)}, ${posBefore.z?.toFixed(2)})`)

    // Move forward
    player.controller.movementInput = { x: 1, y: 0 }
    player.controller.crouching = true

    // Wait for movement
    await new Promise(r => setTimeout(r, 300))

    const posAfter = { ...player.position }
    console.log(`  After move: (${posAfter.x?.toFixed(2)}, ${posAfter.z?.toFixed(2)})`)

    const distance = Math.hypot(
      posAfter.x - posBefore.x,
      posAfter.z - posBefore.z
    )
    console.log(`  Distance: ${distance?.toFixed(3)} units`)

    const result = distance > 0.1
    console.log(`  Result: ${result ? '✓ PASS' : '✗ FAIL'}`)
    return result
  })

  tests.crouchedMovement = result
  return result
}

async function test3_UncrouchInOpen() {
  console.log('\n--- Test 3: Uncrouch in Open Space ---')

  const result = await page.evaluate(async () => {
    const player = window.debug.client.localPlayer
    if (!player?.controller) {
      console.log('✗ No player controller')
      return false
    }

    // Crouch
    player.controller.crouching = true
    player.controller.movementInput = { x: 0, y: 0 }
    await new Promise(r => setTimeout(r, 150))

    const crouchY = player.position.y
    console.log(`  Crouched Y: ${crouchY?.toFixed(3)}`)

    // Uncrouch
    player.controller.crouching = false
    await new Promise(r => setTimeout(r, 150))

    const standY = player.position.y
    console.log(`  Standing Y: ${standY?.toFixed(3)}`)

    const yDiff = standY - crouchY
    console.log(`  Y change: ${yDiff?.toFixed(3)} units`)

    const result = yDiff > 0.05
    console.log(`  Result: ${result ? '✓ PASS' : '✗ FAIL'}`)
    return result
  })

  tests.uncrouchInOpen = result
  return result
}

async function test4_RapidTransitions() {
  console.log('\n--- Test 4: Rapid Crouch/Uncrouch ---')

  const result = await page.evaluate(async () => {
    const player = window.debug.client.localPlayer
    if (!player?.controller) {
      console.log('✗ No player controller')
      return false
    }

    console.log('  Performing 10 rapid transitions...')

    // Perform rapid transitions
    for (let i = 0; i < 10; i++) {
      player.controller.crouching = i % 2 === 0
      await new Promise(r => setTimeout(r, 50))
    }

    // End standing
    player.controller.crouching = false
    await new Promise(r => setTimeout(r, 150))

    const finalY = player.position.y
    console.log(`  Final Y: ${finalY?.toFixed(3)}`)

    const result = finalY > 0
    console.log(`  Result: ${result ? '✓ PASS' : '✗ FAIL'}`)
    return result
  })

  tests.rapidTransitions = result
  return result
}

async function test5_NoClipping() {
  console.log('\n--- Test 5: No Ceiling Clipping ---')

  const result = await page.evaluate(async () => {
    const player = window.debug.client.localPlayer
    if (!player?.controller) {
      console.log('✗ No player controller')
      return false
    }

    const initialY = player.position.y

    // Crouch then uncrouch quickly
    player.controller.crouching = true
    await new Promise(r => setTimeout(r, 100))

    player.controller.crouching = false
    await new Promise(r => setTimeout(r, 100))

    const finalY = player.position.y

    // Check no excessive falling or rising
    const yDiff = Math.abs(finalY - initialY)
    console.log(`  Initial Y: ${initialY?.toFixed(3)}`)
    console.log(`  Final Y: ${finalY?.toFixed(3)}`)
    console.log(`  Y difference: ${yDiff?.toFixed(3)}`)

    const result = yDiff < 0.5 && finalY > 0
    console.log(`  Result: ${result ? '✓ PASS' : '✗ FAIL'}`)
    return result
  })

  tests.noClipping = result
  return result
}

async function runTests() {
  try {
    console.log('=== CROUCH MECHANICS TEST (60 TPS) ===\n')

    // Start server
    await startServer()

    // Open browser
    await setupBrowser()

    // Wait for player spawn
    const playerId = await waitForPlayer()
    if (!playerId) {
      console.log('ERROR: Player failed to spawn')
      process.exit(1)
    }

    console.log(`Player spawned: ${playerId}\n`)

    // Run tests
    await test1_CrouchEngagement()
    await test2_CrouchedMovement()
    await test3_UncrouchInOpen()
    await test4_RapidTransitions()
    await test5_NoClipping()

    // Summary
    console.log('\n=== TEST SUMMARY ===')
    let passed = 0
    let failed = 0

    for (const [test, result] of Object.entries(tests)) {
      if (result) {
        console.log(`✓ ${test}`)
        passed++
      } else {
        console.log(`✗ ${test}`)
        failed++
      }
    }

    console.log(`\nTotal: ${passed}/${passed + failed} passed`)

    // Keep browser open for manual inspection
    console.log('\nBrowser window open for manual verification.')
    console.log('Close the browser to exit.')
    console.log('Press Ctrl+C to force exit.')

    await new Promise(r => setTimeout(r, 60000)) // 1 minute

  } catch (e) {
    console.error('Test failed:', e.message)
    console.error(e.stack)
    process.exit(1)
  } finally {
    if (page) await page.close()
    if (browser) await browser.close()
    if (server) server.stop?.()
  }
}

runTests()
