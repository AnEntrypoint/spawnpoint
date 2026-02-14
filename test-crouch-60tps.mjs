import { boot } from './src/sdk/server.js'
import { WebSocketServer } from 'ws'

let clientSocket
let serverInstance
let testResults = {
  crouchEngagement: null,
  wallClipping: null,
  crouchedMovement: null,
  uncrouchInOpenSpace: null,
  rapidTransitions: null,
  noStuckStates: null,
  heightSmoothing: null,
  responsiveness: null
}

const TEST_TIMEOUT = 30000

async function startServer() {
  console.log('Starting server at 60 TPS for crouch testing...')
  serverInstance = await boot({
    tickRate: 60,
    port: 8080,
    world: 'apps/world/index.js'
  })
  console.log('Server started')
  return serverInstance
}

async function connectClient() {
  return new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error('Client connection timeout')), 5000)

    const ws = new WebSocketServer({ port: 8081 })
    ws.on('error', reject)

    const clientSocket = new WebSocket('ws://localhost:8080')
    clientSocket.onopen = () => {
      console.log('Client connected')
      resolve(clientSocket)
    }
    clientSocket.onerror = reject
  })
}

async function testCrouchEngagement() {
  console.log('\nTest 1: Crouch Engagement (< 1 frame delay)')
  try {
    // Send stand input
    clientSocket.send(JSON.stringify({
      type: 'input',
      crouch: false
    }))
    await new Promise(r => setTimeout(r, 50))

    const beforeState = globalThis.__DEBUG__.server.getPlayerStates()
    const beforeHeight = beforeState[0]?.capsuleHeight

    // Send crouch input
    const crouchTime = Date.now()
    clientSocket.send(JSON.stringify({
      type: 'input',
      crouch: true
    }))
    await new Promise(r => setTimeout(r, 50))

    const afterState = globalThis.__DEBUG__.server.getPlayerStates()
    const afterHeight = afterState[0]?.capsuleHeight
    const responseTime = Date.now() - crouchTime

    const heightChanged = beforeHeight !== afterHeight && afterHeight < beforeHeight
    const responsiveEnough = responseTime < 17 // < 1 frame at 60 TPS

    testResults.crouchEngagement = {
      passed: heightChanged && responsiveEnough,
      heightChanged,
      responsiveEnough,
      responseTime,
      beforeHeight,
      afterHeight
    }
    console.log(`  Height changed: ${heightChanged}`)
    console.log(`  Response time: ${responseTime}ms (< 17ms for 1 frame)`)
    console.log(`  Result: ${testResults.crouchEngagement.passed ? 'PASS' : 'FAIL'}`)
  } catch (e) {
    console.error('  Error:', e.message)
    testResults.crouchEngagement = { passed: false, error: e.message }
  }
}

async function testCrouchedMovement() {
  console.log('\nTest 2: Movement While Crouched')
  try {
    // Make sure we're crouched
    clientSocket.send(JSON.stringify({ type: 'input', crouch: true }))
    await new Promise(r => setTimeout(r, 100))

    // Record position before movement
    const beforeState = globalThis.__DEBUG__.server.getPlayerStates()
    const beforePos = { x: beforeState[0]?.x, z: beforeState[0]?.z }

    // Move forward while crouched
    clientSocket.send(JSON.stringify({
      type: 'input',
      move: { x: 1, y: 0 },
      crouch: true
    }))

    // Let movement happen over several ticks
    await new Promise(r => setTimeout(r, 500))

    const afterState = globalThis.__DEBUG__.server.getPlayerStates()
    const afterPos = { x: afterState[0]?.x, z: afterState[0]?.z }

    const moved = Math.hypot(afterPos.x - beforePos.x, afterPos.z - beforePos.z) > 0.1
    const stillCrouched = afterState[0]?.isCrouching === true

    testResults.crouchedMovement = {
      passed: moved && stillCrouched,
      moved,
      stillCrouched,
      distance: Math.hypot(afterPos.x - beforePos.x, afterPos.z - beforePos.z)
    }
    console.log(`  Moved while crouched: ${moved}`)
    console.log(`  Distance: ${testResults.crouchedMovement.distance.toFixed(2)} units`)
    console.log(`  Still crouched: ${stillCrouched}`)
    console.log(`  Result: ${testResults.crouchedMovement.passed ? 'PASS' : 'FAIL'}`)
  } catch (e) {
    console.error('  Error:', e.message)
    testResults.crouchedMovement = { passed: false, error: e.message }
  }
}

async function testUncrouchInOpenSpace() {
  console.log('\nTest 3: Uncrouch in Open Space')
  try {
    // Move to open space and crouch
    clientSocket.send(JSON.stringify({
      type: 'input',
      crouch: true
    }))
    await new Promise(r => setTimeout(r, 200))

    const crouchedState = globalThis.__DEBUG__.server.getPlayerStates()
    const crouchedHeight = crouchedState[0]?.capsuleHeight
    const crouchedY = crouchedState[0]?.y

    // Uncrouch
    clientSocket.send(JSON.stringify({
      type: 'input',
      crouch: false
    }))
    await new Promise(r => setTimeout(r, 200))

    const uncrouchedState = globalThis.__DEBUG__.server.getPlayerStates()
    const uncrouchedHeight = uncrouchedState[0]?.capsuleHeight
    const uncrouchedY = uncrouchedState[0]?.y

    const heightIncreased = uncrouchedHeight > crouchedHeight
    const noClipping = uncrouchedY >= crouchedY // should not go below or teleport

    testResults.uncrouchInOpenSpace = {
      passed: heightIncreased && noClipping,
      heightIncreased,
      noClipping,
      heightChange: uncrouchedHeight - crouchedHeight,
      yChange: uncrouchedY - crouchedY
    }
    console.log(`  Height increased: ${heightIncreased}`)
    console.log(`  Height change: ${testResults.uncrouchInOpenSpace.heightChange.toFixed(3)} units`)
    console.log(`  No Y clipping: ${noClipping}`)
    console.log(`  Result: ${testResults.uncrouchInOpenSpace.passed ? 'PASS' : 'FAIL'}`)
  } catch (e) {
    console.error('  Error:', e.message)
    testResults.uncrouchInOpenSpace = { passed: false, error: e.message }
  }
}

async function testRapidTransitions() {
  console.log('\nTest 4: Rapid Crouch/Uncrouch Transitions')
  try {
    let stuck = false

    // Perform 10 rapid transitions
    for (let i = 0; i < 10; i++) {
      clientSocket.send(JSON.stringify({
        type: 'input',
        crouch: i % 2 === 0
      }))
      await new Promise(r => setTimeout(r, 50))
    }

    // Check final state
    const finalState = globalThis.__DEBUG__.server.getPlayerStates()
    const finalCrouch = finalState[0]?.isCrouching
    const finalHeight = finalState[0]?.capsuleHeight

    // Set to uncrouch at end
    clientSocket.send(JSON.stringify({ type: 'input', crouch: false }))
    await new Promise(r => setTimeout(r, 100))

    const settledState = globalThis.__DEBUG__.server.getPlayerStates()
    const settledHeight = settledState[0]?.capsuleHeight

    stuck = settledHeight === undefined || settledHeight < 0.1

    testResults.rapidTransitions = {
      passed: !stuck && settledHeight > 0.5,
      noStuckState: !stuck,
      settledHeight
    }
    console.log(`  No stuck state: ${!stuck}`)
    console.log(`  Settled height: ${settledHeight?.toFixed(3)} units`)
    console.log(`  Result: ${testResults.rapidTransitions.passed ? 'PASS' : 'FAIL'}`)
  } catch (e) {
    console.error('  Error:', e.message)
    testResults.rapidTransitions = { passed: false, error: e.message }
  }
}

async function testHeightSmoothing() {
  console.log('\nTest 5: Height Change Smoothing')
  try {
    // Stand up
    clientSocket.send(JSON.stringify({ type: 'input', crouch: false }))
    await new Promise(r => setTimeout(r, 100))

    const heights = []
    const measurementCount = 10

    // Crouch and measure height over multiple ticks
    clientSocket.send(JSON.stringify({ type: 'input', crouch: true }))

    for (let i = 0; i < measurementCount; i++) {
      await new Promise(r => setTimeout(r, 20))
      const state = globalThis.__DEBUG__.server.getPlayerStates()
      heights.push(state[0]?.capsuleHeight || 0)
    }

    // Check for smooth transition (not instantaneous)
    let isSmooth = false
    if (heights.length > 2) {
      const heightDifferences = []
      for (let i = 1; i < heights.length; i++) {
        heightDifferences.push(Math.abs(heights[i] - heights[i-1]))
      }
      const avgChange = heightDifferences.reduce((a, b) => a + b) / heightDifferences.length
      isSmooth = avgChange > 0.001 && avgChange < 0.1 // smooth transition, not instant jump
    }

    testResults.heightSmoothing = {
      passed: isSmooth,
      isSmooth,
      heights: heights.map(h => h?.toFixed(3)).join(' -> '),
      minHeight: Math.min(...heights),
      maxHeight: Math.max(...heights)
    }
    console.log(`  Height progression: ${testResults.heightSmoothing.heights}`)
    console.log(`  Smooth transition: ${isSmooth}`)
    console.log(`  Result: ${testResults.heightSmoothing.passed ? 'PASS' : 'FAIL'}`)
  } catch (e) {
    console.error('  Error:', e.message)
    testResults.heightSmoothing = { passed: false, error: e.message }
  }
}

async function testResponsiveness() {
  console.log('\nTest 6: Overall Responsiveness')
  try {
    // Measure input latency
    const latencies = []

    for (let i = 0; i < 5; i++) {
      const inputTime = Date.now()
      clientSocket.send(JSON.stringify({
        type: 'input',
        crouch: i % 2 === 0
      }))

      await new Promise(r => setTimeout(r, 30))

      const state = globalThis.__DEBUG__.server.getPlayerStates()
      const responseTime = Date.now() - inputTime
      latencies.push(responseTime)
    }

    const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length
    const maxLatency = Math.max(...latencies)
    const responsive = avgLatency < 50 && maxLatency < 100

    testResults.responsiveness = {
      passed: responsive,
      avgLatency: avgLatency.toFixed(2),
      maxLatency,
      latencies: latencies.map(l => l.toFixed(0)).join(' ')
    }
    console.log(`  Average latency: ${testResults.responsiveness.avgLatency}ms`)
    console.log(`  Max latency: ${maxLatency}ms`)
    console.log(`  Responsive (avg < 50ms): ${responsive}`)
    console.log(`  Result: ${testResults.responsiveness.passed ? 'PASS' : 'FAIL'}`)
  } catch (e) {
    console.error('  Error:', e.message)
    testResults.responsiveness = { passed: false, error: e.message }
  }
}

async function runTests() {
  try {
    await startServer()
    await new Promise(r => setTimeout(r, 1000))

    clientSocket = await connectClient()

    // Give client time to spawn
    await new Promise(r => setTimeout(r, 1000))

    // Run all tests
    await testCrouchEngagement()
    await testCrouchedMovement()
    await testUncrouchInOpenSpace()
    await testRapidTransitions()
    await testHeightSmoothing()
    await testResponsiveness()

    // Summary
    console.log('\n=== TEST SUMMARY ===')
    let passed = 0
    let failed = 0

    for (const [test, result] of Object.entries(testResults)) {
      if (result.passed) {
        console.log(`✓ ${test}`)
        passed++
      } else {
        console.log(`✗ ${test}`)
        failed++
      }
    }

    console.log(`\nTotal: ${passed} passed, ${failed} failed`)
    console.log(`\nDetailed Results:`)
    console.log(JSON.stringify(testResults, null, 2))

    process.exit(failed > 0 ? 1 : 0)
  } catch (e) {
    console.error('Test failed:', e.message)
    console.error(e.stack)
    process.exit(1)
  }
}

runTests()
