#!/usr/bin/env node
import { boot } from './src/sdk/server.js'
import { WebSocket } from 'ws'
import { pack, unpack } from './src/protocol/msgpack.js'
import { MSG } from './src/protocol/MessageTypes.js'

const TEST_PORT = 3001
const TEST_DURATION = 5000

let serverReady = false
let measurements = {
  jumpStartTime: null,
  apexTime: null,
  landingTime: null,
  maxHeight: 0,
  positions: [],
  velocities: [],
  onGroundStates: [],
  timestamps: [],
  jumpInitiated: false,
  apexDetected: false,
  landingDetected: false
}

async function startTestServer() {
  console.log('[TEST] Starting server at 60 TPS on port', TEST_PORT)

  process.env.PORT = TEST_PORT

  const serverPromise = boot({
    overrides: {
      port: TEST_PORT,
      tickRate: 60
    }
  })

  serverReady = true
  console.log('[TEST] Server started')

  return serverPromise
}

async function connectAndTest() {
  return new Promise((resolve) => {
    const url = `ws://localhost:${TEST_PORT}`
    const ws = new WebSocket(url)
    let clientId = null
    let lastSnapshot = null
    let measurementStartTime = null
    let frameCount = 0

    ws.binaryType = 'arraybuffer'

    ws.on('open', () => {
      console.log('[TEST] Connected to server')
    })

    ws.on('message', (data) => {
      try {
        const arrayBuffer = data instanceof ArrayBuffer ? data : data.buffer
        const msg = unpack(new Uint8Array(arrayBuffer))

        frameCount++

        if (msg.type === MSG.SNAPSHOT) {
          if (!measurementStartTime) {
            measurementStartTime = Date.now()
          }

          const elapsed = Date.now() - measurementStartTime

          if (msg.payload && msg.payload.players && msg.payload.players.length > 0) {
            const playerData = msg.payload.players[0]
            if (!Array.isArray(playerData) || playerData.length < 12) {
              console.log('[TEST] Warning: unexpected player data format')
              return
            }
            const pos = [playerData[1], playerData[2], playerData[3]]
            const vel = [playerData[8], playerData[9], playerData[10]]
            const onGround = playerData[11] === 1

            measurements.timestamps.push(elapsed)
            measurements.positions.push([...pos])
            measurements.velocities.push([...vel])
            measurements.onGroundStates.push(onGround)

            if (pos[1] > measurements.maxHeight) {
              measurements.maxHeight = pos[1]
            }

            if (!measurements.jumpInitiated && onGround && elapsed > 500) {
              console.log('[TEST] Player on ground, initiating jump at', elapsed, 'ms')
              measurements.jumpInitiated = true
              measurements.jumpStartTime = elapsed

              const inputMsg = pack({
                type: MSG.INPUT,
                payload: {
                  jump: true,
                  forward: false,
                  backward: false,
                  left: false,
                  right: false,
                  yaw: 0,
                  pitch: 0,
                  crouch: false,
                  sprint: false
                }
              })
              ws.send(inputMsg)
            } else if (measurements.jumpInitiated && !measurements.apexDetected && vel[1] <= 0.05) {
              console.log('[TEST] Apex reached at', elapsed, 'ms, height:', pos[1].toFixed(3))
              measurements.apexTime = elapsed
              measurements.apexDetected = true
            } else if (measurements.jumpInitiated && measurements.apexDetected && onGround && !measurements.landingDetected) {
              console.log('[TEST] Landing detected at', elapsed, 'ms')
              measurements.landingTime = elapsed
              measurements.landingDetected = true
            }
          }

          if (elapsed > TEST_DURATION) {
            console.log('[TEST] Test duration reached')
            ws.close()
            resolve(measurements)
          }
        }
      } catch (err) {
        console.error('[TEST] Error parsing message:', err.message)
      }
    })

    ws.on('error', (err) => {
      console.error('[TEST] WebSocket error:', err.message)
      resolve(measurements)
    })

    ws.on('close', () => {
      console.log('[TEST] WebSocket closed')
      resolve(measurements)
    })

    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
      resolve(measurements)
    }, TEST_DURATION + 2000)
  })
}

async function analyzeResults(measurements) {
  console.log('\n=== JUMP DYNAMICS TEST RESULTS (60 TPS) ===\n')

  if (!measurements.jumpStartTime) {
    console.log('ERROR: Jump was not initiated')
    return
  }

  console.log('Raw measurements:')
  console.log('  Jump initiated at:', measurements.jumpStartTime, 'ms')
  console.log('  Apex reached at:', measurements.apexTime, 'ms')
  console.log('  Landing at:', measurements.landingTime, 'ms')
  console.log('  Max height:', measurements.maxHeight.toFixed(4), 'meters')

  if (measurements.apexTime && measurements.jumpStartTime) {
    const timeToApex = measurements.apexTime - measurements.jumpStartTime
    console.log('\n  Time to apex:', timeToApex, 'ms')
  }

  if (measurements.landingTime && measurements.jumpStartTime) {
    const totalHangTime = measurements.landingTime - measurements.jumpStartTime
    console.log('  Total hang time:', totalHangTime, 'ms')
  }

  console.log('\nPhysics verification:')
  const jumpImpulse = 4.0
  const gravity = 9.81
  const expectedHeight = (jumpImpulse * jumpImpulse) / (2 * gravity)
  const expectedApexTime = jumpImpulse / gravity
  const expectedHangTime = 2 * expectedApexTime

  console.log('  Expected jump height:', expectedHeight.toFixed(4), 'meters')
  console.log('  Expected apex time:', (expectedApexTime * 1000).toFixed(1), 'ms')
  console.log('  Expected hang time:', (expectedHangTime * 1000).toFixed(1), 'ms')

  console.log('\nTolerance analysis:')
  const heightTolerance = 0.05
  const heightMin = expectedHeight * (1 - heightTolerance)
  const heightMax = expectedHeight * (1 + heightTolerance)
  console.log('  Height tolerance (±5%):', heightMin.toFixed(4), '-', heightMax.toFixed(4), 'meters')

  if (measurements.maxHeight >= heightMin && measurements.maxHeight <= heightMax) {
    console.log('  ✓ Height within tolerance')
  } else {
    console.log('  ✗ Height OUTSIDE tolerance')
  }

  const apexTimeTolerance = 50
  if (measurements.apexTime && Math.abs(measurements.apexTime - (expectedApexTime * 1000)) <= apexTimeTolerance) {
    console.log('  ✓ Apex time within ±50ms')
  } else if (measurements.apexTime) {
    console.log('  ✗ Apex time OUTSIDE ±50ms')
  }

  const hangTimeTolerance = 100
  if (measurements.landingTime && measurements.jumpStartTime &&
      Math.abs((measurements.landingTime - measurements.jumpStartTime) - (expectedHangTime * 1000)) <= hangTimeTolerance) {
    console.log('  ✓ Hang time within ±100ms')
  } else if (measurements.landingTime && measurements.jumpStartTime) {
    console.log('  ✗ Hang time OUTSIDE ±100ms')
  }

  console.log('\nVelocity profile at key moments:')
  if (measurements.jumpStartTime && measurements.positions.length > 0) {
    const jumpIdx = Math.floor(measurements.jumpStartTime / (1000 / 60))
    if (jumpIdx < measurements.velocities.length) {
      console.log('  At jump:', measurements.velocities[jumpIdx].map(v => v.toFixed(3)).join(', '))
    }
  }

  if (measurements.apexTime && measurements.positions.length > 0) {
    const apexIdx = Math.floor(measurements.apexTime / (1000 / 60))
    if (apexIdx < measurements.velocities.length) {
      console.log('  At apex:', measurements.velocities[apexIdx].map(v => v.toFixed(3)).join(', '))
    }
  }

  console.log('\nSnapshots around jump:')
  measurements.positions.forEach((pos, i) => {
    const time = measurements.timestamps[i]
    if (time >= (measurements.jumpStartTime - 100) && time <= (measurements.landingTime || measurements.jumpStartTime + 2000)) {
      const marker =
        time === measurements.jumpStartTime ? ' [JUMP]' :
        time === measurements.apexTime ? ' [APEX]' :
        time === measurements.landingTime ? ' [LAND]' : ''
      console.log(`  ${time.toFixed(0)}ms: y=${pos[1].toFixed(4)}m vy=${measurements.velocities[i][1].toFixed(3)}m/s ground=${measurements.onGroundStates[i]}${marker}`)
    }
  })
}

async function main() {
  try {
    await startTestServer()

    await new Promise(resolve => setTimeout(resolve, 1000))

    const measurements = await connectAndTest()

    await analyzeResults(measurements)

    process.exit(0)
  } catch (err) {
    console.error('[TEST] Fatal error:', err.message)
    console.error(err.stack)
    process.exit(1)
  }
}

main()
