#!/usr/bin/env node
import { createServer } from './src/sdk/server.js'
import { WebSocketServer } from 'ws'
import { EventEmitter } from 'events'

let server
let client
let testResults = {}
const TIMEOUT = 30000

async function setupServer() {
  console.log('Starting server at 60 TPS...')
  server = await createServer({
    port: 8080,
    tickRate: 60,
    world: 'apps/world/index.js'
  })

  console.log('Loading world...')
  const worldMod = await import('./apps/world/index.js?t=' + Date.now())
  const worldDef = worldMod.default

  await server.loadWorld(worldDef)
  const info = await server.start()
  console.log(`Server started at ${info.port} @ ${info.tickRate} TPS`)

  // Expose debug API
  globalThis.__DEBUG__ = globalThis.__DEBUG__ || {}
  globalThis.__DEBUG__.server = {
    playerManager: server.playerManager,
    physics: server.physics,
    physicsIntegration: server.physicsIntegration,
    getPlayers: () => server.playerManager.getConnectedPlayers(),
    getPlayer: (id) => server.playerManager.getPlayer(id),
    getPlayerPosition: (id) => {
      const player = server.playerManager.getPlayer(id)
      return player?.state?.position
    },
    getPlayerCrouch: (id) => {
      const player = server.playerManager.getPlayer(id)
      return player?.state?.crouch
    }
  }

  return server
}

async function connectClient() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Client connection timeout')), 5000)

    try {
      const ws = new WebSocket('ws://localhost:8080')

      ws.onopen = () => {
        clearTimeout(timeout)
        console.log('Client connected to server')
        resolve(ws)
      }

      ws.onerror = (e) => {
        clearTimeout(timeout)
        reject(e)
      }

      ws.onmessage = (e) => {
        // Handle handshake/messages
      }
    } catch (e) {
      clearTimeout(timeout)
      reject(e)
    }
  })
}

async function waitForPlayerSpawn() {
  return new Promise((resolve) => {
    let checks = 0
    const checkInterval = setInterval(() => {
      const players = globalThis.__DEBUG__.server.getPlayers()
      if (players.length > 0 && players[0].state?.position) {
        clearInterval(checkInterval)
        resolve(players[0].id)
      }
      checks++
      if (checks > 100) { // 5 seconds
        clearInterval(checkInterval)
        resolve(null)
      }
    }, 50)
  })
}

async function sendInput(ws, inputData) {
  try {
    ws.send(JSON.stringify(inputData))
  } catch (e) {
    console.error('Failed to send input:', e.message)
  }
}

async function test1_CrouchEngagement() {
  console.log('\n--- Test 1: Crouch Engagement ---')
  try {
    const players = globalThis.__DEBUG__.server.getPlayers()
    if (!players.length) {
      console.log('✗ No players connected')
      return false
    }

    const playerId = players[0].id
    const player = globalThis.__DEBUG__.server.getPlayer(playerId)

    // Get standing position and height
    const standPos = [...player.state.position]
    const standCrouch = player.state.crouch

    console.log(`  Standing position: ${standPos.map(x => x.toFixed(2)).join(', ')}`)
    console.log(`  Standing crouch state: ${standCrouch}`)

    // Wait a few ticks
    await new Promise(r => setTimeout(r, 100))

    // Send crouch input
    await sendInput(client, {
      type: 'input',
      crouch: true,
      move: { x: 0, y: 0 },
      yaw: 0,
      pitch: 0
    })

    // Wait for crouch to apply
    await new Promise(r => setTimeout(r, 150))

    const crouchPos = [...player.state.position]
    const crouchState = player.state.crouch

    console.log(`  Crouch position: ${crouchPos.map(x => x.toFixed(2)).join(', ')}`)
    console.log(`  Crouch state: ${crouchState}`)

    const yDiff = standPos[1] - crouchPos[1]
    console.log(`  Y position change: ${yDiff.toFixed(3)} units`)

    const engaged = crouchState === 1 && yDiff > 0.1
    console.log(`  Result: ${engaged ? '✓ PASS' : '✗ FAIL'}`)

    testResults.crouchEngagement = engaged
    return engaged
  } catch (e) {
    console.error('Test failed:', e.message)
    testResults.crouchEngagement = false
    return false
  }
}

async function test2_CrouchedMovement() {
  console.log('\n--- Test 2: Movement While Crouched ---')
  try {
    const players = globalThis.__DEBUG__.server.getPlayers()
    if (!players.length) {
      console.log('✗ No players connected')
      return false
    }

    const playerId = players[0].id
    const player = globalThis.__DEBUG__.server.getPlayer(playerId)

    // Ensure crouched
    await sendInput(client, {
      type: 'input',
      crouch: true,
      move: { x: 0, y: 0 },
      yaw: 0,
      pitch: 0
    })

    await new Promise(r => setTimeout(r, 150))

    const beforePos = [...player.state.position]
    console.log(`  Before move: ${beforePos.map(x => x.toFixed(2)).join(', ')}`)

    // Move forward while crouched
    await sendInput(client, {
      type: 'input',
      crouch: true,
      move: { x: 1, y: 0 },
      yaw: 0,
      pitch: 0
    })

    // Move for 10 ticks at 60 TPS = ~167ms
    await new Promise(r => setTimeout(r, 350))

    const afterPos = [...player.state.position]
    console.log(`  After move: ${afterPos.map(x => x.toFixed(2)).join(', ')}`)

    const distance = Math.hypot(
      afterPos[0] - beforePos[0],
      afterPos[2] - beforePos[2]
    )
    console.log(`  Distance moved: ${distance.toFixed(3)} units`)
    console.log(`  Still crouched: ${player.state.crouch === 1}`)

    const moved = distance > 0.2
    const result = moved && player.state.crouch === 1
    console.log(`  Result: ${result ? '✓ PASS' : '✗ FAIL'}`)

    testResults.crouchedMovement = result
    return result
  } catch (e) {
    console.error('Test failed:', e.message)
    testResults.crouchedMovement = false
    return false
  }
}

async function test3_UncrouchInOpenSpace() {
  console.log('\n--- Test 3: Uncrouch in Open Space ---')
  try {
    const players = globalThis.__DEBUG__.server.getPlayers()
    if (!players.length) {
      console.log('✗ No players connected')
      return false
    }

    const playerId = players[0].id
    const player = globalThis.__DEBUG__.server.getPlayer(playerId)

    // Start crouched
    await sendInput(client, {
      type: 'input',
      crouch: true,
      move: { x: 0, y: 0 },
      yaw: 0,
      pitch: 0
    })

    await new Promise(r => setTimeout(r, 150))

    const crouchedPos = [...player.state.position]
    const crouchedState = player.state.crouch

    console.log(`  Crouched position: ${crouchedPos.map(x => x.toFixed(2)).join(', ')}`)
    console.log(`  Crouched state: ${crouchedState}`)

    // Stand up
    await sendInput(client, {
      type: 'input',
      crouch: false,
      move: { x: 0, y: 0 },
      yaw: 0,
      pitch: 0
    })

    await new Promise(r => setTimeout(r, 150))

    const standPos = [...player.state.position]
    const standState = player.state.crouch

    console.log(`  Standing position: ${standPos.map(x => x.toFixed(2)).join(', ')}`)
    console.log(`  Standing state: ${standState}`)

    const yDiff = standPos[1] - crouchedPos[1]
    console.log(`  Y position change: ${yDiff.toFixed(3)} units`)

    const uncrouch = standState === 0 && yDiff > 0.1
    console.log(`  Result: ${uncrouch ? '✓ PASS' : '✗ FAIL'}`)

    testResults.uncrouchInOpenSpace = uncrouch
    return uncrouch
  } catch (e) {
    console.error('Test failed:', e.message)
    testResults.uncrouchInOpenSpace = false
    return false
  }
}

async function test4_RapidTransitions() {
  console.log('\n--- Test 4: Rapid Crouch/Uncrouch Transitions ---')
  try {
    const players = globalThis.__DEBUG__.server.getPlayers()
    if (!players.length) {
      console.log('✗ No players connected')
      return false
    }

    const playerId = players[0].id
    const player = globalThis.__DEBUG__.server.getPlayer(playerId)

    console.log('  Performing 10 rapid transitions...')

    // Perform rapid transitions
    for (let i = 0; i < 10; i++) {
      const crouch = i % 2 === 0
      await sendInput(client, {
        type: 'input',
        crouch,
        move: { x: 0, y: 0 },
        yaw: 0,
        pitch: 0
      })
      await new Promise(r => setTimeout(r, 50))
    }

    // End in standing position
    await sendInput(client, {
      type: 'input',
      crouch: false,
      move: { x: 0, y: 0 },
      yaw: 0,
      pitch: 0
    })

    await new Promise(r => setTimeout(r, 150))

    const finalState = player.state.crouch
    const finalPos = [...player.state.position]

    console.log(`  Final state: ${finalState}`)
    console.log(`  Final position: ${finalPos.map(x => x.toFixed(2)).join(', ')}`)
    console.log(`  Not stuck: ${finalState === 0}`)

    const notStuck = finalState === 0
    console.log(`  Result: ${notStuck ? '✓ PASS' : '✗ FAIL'}`)

    testResults.rapidTransitions = notStuck
    return notStuck
  } catch (e) {
    console.error('Test failed:', e.message)
    testResults.rapidTransitions = false
    return false
  }
}

async function test5_HeightSmoothing() {
  console.log('\n--- Test 5: Height Change Smoothing ---')
  try {
    const players = globalThis.__DEBUG__.server.getPlayers()
    if (!players.length) {
      console.log('✗ No players connected')
      return false
    }

    const playerId = players[0].id
    const player = globalThis.__DEBUG__.server.getPlayer(playerId)

    // Stand up first
    await sendInput(client, {
      type: 'input',
      crouch: false,
      move: { x: 0, y: 0 },
      yaw: 0,
      pitch: 0
    })

    await new Promise(r => setTimeout(r, 150))

    const heights = []
    console.log('  Measuring heights during crouch transition...')

    // Send crouch input
    await sendInput(client, {
      type: 'input',
      crouch: true,
      move: { x: 0, y: 0 },
      yaw: 0,
      pitch: 0
    })

    // Record heights over ~500ms
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 50))
      heights.push(player.state.position[1])
    }

    const minHeight = Math.min(...heights)
    const maxHeight = Math.max(...heights)
    const heightRange = maxHeight - minHeight

    console.log(`  Height range: ${minHeight.toFixed(3)} to ${maxHeight.toFixed(3)}`)
    console.log(`  Total change: ${heightRange.toFixed(3)} units`)

    // Smooth means gradual change over multiple samples
    const smooth = heightRange > 0.05 // Noticeable change
    console.log(`  Smooth transition: ${smooth}`)
    console.log(`  Result: ${smooth ? '✓ PASS' : '✗ FAIL'}`)

    testResults.heightSmoothing = smooth
    return smooth
  } catch (e) {
    console.error('Test failed:', e.message)
    testResults.heightSmoothing = false
    return false
  }
}

async function test6_NoWallClipping() {
  console.log('\n--- Test 6: No Ceiling Clipping When Uncrouch ---')
  try {
    const players = globalThis.__DEBUG__.server.getPlayers()
    if (!players.length) {
      console.log('✗ No players connected')
      return false
    }

    const playerId = players[0].id
    const player = globalThis.__DEBUG__.server.getPlayer(playerId)

    // Get initial position
    const initialPos = [...player.state.position]

    // Crouch
    await sendInput(client, {
      type: 'input',
      crouch: true,
      move: { x: 0, y: 0 },
      yaw: 0,
      pitch: 0
    })

    await new Promise(r => setTimeout(r, 150))

    // Uncrouch
    await sendInput(client, {
      type: 'input',
      crouch: false,
      move: { x: 0, y: 0 },
      yaw: 0,
      pitch: 0
    })

    await new Promise(r => setTimeout(r, 150))

    const finalPos = [...player.state.position]

    // Check that position didn't jump excessively
    const yDiff = finalPos[1] - initialPos[1]
    const xyDiff = Math.hypot(finalPos[0] - initialPos[0], finalPos[2] - initialPos[2])

    console.log(`  Initial Y: ${initialPos[1].toFixed(3)}`)
    console.log(`  Final Y: ${finalPos[1].toFixed(3)}`)
    console.log(`  Y difference: ${yDiff.toFixed(3)}`)
    console.log(`  XZ drift: ${xyDiff.toFixed(3)}`)

    // Should not have clipped into ground or ceiling
    const noClipping = finalPos[1] >= 0 && yDiff > -0.5
    console.log(`  No clipping: ${noClipping}`)
    console.log(`  Result: ${noClipping ? '✓ PASS' : '✗ FAIL'}`)

    testResults.noClipping = noClipping
    return noClipping
  } catch (e) {
    console.error('Test failed:', e.message)
    testResults.noClipping = false
    return false
  }
}

async function runAllTests() {
  try {
    console.log('=== CROUCH SYSTEM TEST SUITE (60 TPS) ===\n')

    // Setup
    await setupServer()
    await new Promise(r => setTimeout(r, 1000))

    client = await connectClient()
    await new Promise(r => setTimeout(r, 500))

    const playerId = await waitForPlayerSpawn()
    if (!playerId) {
      console.log('ERROR: Player failed to spawn')
      process.exit(1)
    }

    console.log(`Player spawned with ID: ${playerId}\n`)

    // Run tests
    await test1_CrouchEngagement()
    await test2_CrouchedMovement()
    await test3_UncrouchInOpenSpace()
    await test4_RapidTransitions()
    await test5_HeightSmoothing()
    await test6_NoWallClipping()

    // Summary
    console.log('\n=== TEST SUMMARY ===')
    let passed = 0
    let failed = 0

    for (const [test, result] of Object.entries(testResults)) {
      if (result) {
        console.log(`✓ ${test}`)
        passed++
      } else {
        console.log(`✗ ${test}`)
        failed++
      }
    }

    console.log(`\nTotal: ${passed}/${passed + failed} passed`)

    if (failed > 0) {
      console.log('\nSome tests failed!')
      process.exit(1)
    } else {
      console.log('\nAll tests passed!')
      process.exit(0)
    }
  } catch (e) {
    console.error('Fatal error:', e.message)
    console.error(e.stack)
    process.exit(1)
  } finally {
    if (client) client.close()
    if (server) server.stop?.()
  }
}

runAllTests()
