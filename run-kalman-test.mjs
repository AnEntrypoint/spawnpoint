import KalmanFilter1D from './src/util/KalmanFilter1D.js'
import KalmanFilterQuaternion from './src/util/KalmanFilterQuaternion.js'
import { createKalmanFilterX, createKalmanFilterY, createKalmanFilterZ, createKalmanFilterVelX, createKalmanFilterVelY, createKalmanFilterVelZ, createKalmanFilterRotation } from './src/util/KalmanFilterFactory.js'

class KalmanPacketLossTest {
  constructor() {
    this.results = {
      scenarios: [],
      summary: {}
    }
  }

  createScenario(name, packetLossRate, durationSeconds, velocity) {
    return {
      name,
      packetLossRate,
      durationSeconds,
      velocity,
      tickRate: 60,
      metrics: {
        errors: [],
        maxPositionError: 0,
        maxVelocityError: 0,
        convergenceTimes: [],
        avgConvergenceTime: 0,
        stability: { hasNaN: false, hasDivergence: false, crashed: false },
        playability: 'unknown'
      }
    }
  }

  isNaN(value) {
    if (typeof value === 'number') return Number.isNaN(value)
    if (Array.isArray(value)) return value.some(v => Number.isNaN(v))
    return false
  }

  isFinite(value) {
    if (typeof value === 'number') return Number.isFinite(value)
    if (Array.isArray(value)) return value.every(v => Number.isFinite(v))
    return false
  }

  runScenario(scenario) {
    const dt = 1 / scenario.tickRate
    const totalTicks = scenario.durationSeconds * scenario.tickRate
    const dropInterval = Math.max(1, Math.round(1 / scenario.packetLossRate))

    const filters = {
      posX: createKalmanFilterX(),
      posY: createKalmanFilterY(),
      posZ: createKalmanFilterZ(),
      velX: createKalmanFilterVelX(),
      velY: createKalmanFilterVelY(),
      velZ: createKalmanFilterVelZ(),
      rotation: createKalmanFilterRotation()
    }

    let truePosition = [0, 0, 0]
    let trueVelocity = [scenario.velocity, 0, 0]
    let trueRotation = [0, 0, 0, 1]
    let lastPacketTick = 0

    for (let tick = 0; tick < totalTicks; tick++) {
      const isPacketTick = tick % dropInterval === 0

      if (isPacketTick) {
        filters.posX.update(truePosition[0])
        filters.posY.update(truePosition[1])
        filters.posZ.update(truePosition[2])
        filters.velX.update(trueVelocity[0])
        filters.velY.update(trueVelocity[1])
        filters.velZ.update(trueVelocity[2])
        filters.rotation.update(trueRotation)
        lastPacketTick = tick
      }

      filters.posX.predict(dt)
      filters.posY.predict(dt)
      filters.posZ.predict(dt)
      filters.velX.predict(dt)
      filters.velY.predict(dt)
      filters.velZ.predict(dt)
      filters.rotation.predict(dt)

      const estimatedPosition = [
        filters.posX.getState().position,
        filters.posY.getState().position,
        filters.posZ.getState().position
      ]

      const error = Math.sqrt(
        Math.pow(estimatedPosition[0] - truePosition[0], 2) +
        Math.pow(estimatedPosition[1] - truePosition[1], 2) +
        Math.pow(estimatedPosition[2] - truePosition[2], 2)
      )

      if (this.isNaN(error)) {
        scenario.metrics.stability.hasNaN = true
      }

      if (!this.isFinite(error) && error !== 0) {
        scenario.metrics.stability.hasDivergence = true
      }

      scenario.metrics.errors.push({
        tick,
        error,
        position: [...estimatedPosition],
        truePosition: [...truePosition],
        ticksSincePacket: tick - lastPacketTick
      })

      if (error > scenario.metrics.maxPositionError) {
        scenario.metrics.maxPositionError = error
      }

      const ticksSincePacket = tick - lastPacketTick
      if (isPacketTick && ticksSincePacket > 0) {
        const convergenceFrame = scenario.metrics.errors.findIndex((e, i) => {
          if (i < scenario.metrics.errors.length - 1) {
            const currErr = e.error
            const threshold = 0.01
            return currErr < threshold
          }
          return false
        })

        if (convergenceFrame > -1) {
          scenario.metrics.convergenceTimes.push(convergenceFrame - lastPacketTick)
        }
      }

      truePosition[0] += trueVelocity[0] * dt
      truePosition[1] += trueVelocity[1] * dt
      truePosition[2] += trueVelocity[2] * dt
    }

    if (scenario.metrics.convergenceTimes.length > 0) {
      scenario.metrics.avgConvergenceTime =
        scenario.metrics.convergenceTimes.reduce((a, b) => a + b, 0) /
        scenario.metrics.convergenceTimes.length
    }

    scenario.metrics.stability.isStable = !scenario.metrics.stability.hasNaN && !scenario.metrics.stability.hasDivergence
    scenario.metrics.playability = this.assessPlayability(
      scenario.packetLossRate,
      scenario.metrics.maxPositionError,
      scenario.metrics.avgConvergenceTime
    )

    return scenario
  }

  assessPlayability(packetLoss, maxError, convergenceTime) {
    if (!Number.isFinite(maxError) || !Number.isFinite(convergenceTime)) {
      return 'unplayable'
    }

    if (packetLoss <= 0.1) {
      if (maxError < 0.5 && convergenceTime < 2) return 'excellent'
      if (maxError < 1.0 && convergenceTime < 5) return 'playable'
      return 'marginal'
    }

    if (packetLoss <= 0.25) {
      if (maxError < 1.5 && convergenceTime < 5) return 'playable'
      if (maxError < 3.0 && convergenceTime < 10) return 'playable-with-artifacts'
      return 'marginal'
    }

    if (packetLoss <= 0.5) {
      if (maxError < 3.0 && convergenceTime < 8) return 'playable-but-noticeable'
      if (maxError < 5.0 && convergenceTime < 15) return 'marginal'
      return 'unplayable'
    }

    return 'unplayable'
  }

  validateThresholds(scenario) {
    const thresholds = {
      '10%': { maxError: 0.5, convergence: 1 },
      '25%': { maxError: 1.5, convergence: 3 },
      '50%': { maxError: 3.0, convergence: 5 }
    }

    const lossKey = `${Math.round(scenario.packetLossRate * 100)}%`
    const threshold = thresholds[lossKey]

    if (!threshold) return { pass: false, reason: 'Unknown loss rate' }

    const maxErrorPass = scenario.metrics.maxPositionError <= threshold.maxError
    const convergencePass = scenario.metrics.avgConvergenceTime <= threshold.convergence
    const stabilityPass = scenario.metrics.stability.isStable

    return {
      pass: maxErrorPass && convergencePass && stabilityPass,
      errors: [
        !maxErrorPass ? `Max error ${scenario.metrics.maxPositionError.toFixed(3)} > threshold ${threshold.maxError}` : null,
        !convergencePass ? `Convergence ${scenario.metrics.avgConvergenceTime.toFixed(2)} > threshold ${threshold.convergence}` : null,
        !stabilityPass ? 'Filter instability detected (NaN or divergence)' : null
      ].filter(Boolean)
    }
  }

  generateReport() {
    let report = '═══════════════════════════════════════════════════════════════════════════════\n'
    report += 'KALMAN FILTER PACKET LOSS ROBUSTNESS TEST REPORT\n'
    report += '═══════════════════════════════════════════════════════════════════════════════\n\n'

    report += 'TEST CONFIGURATION\n'
    report += '─────────────────────────────────────────────────────────────────────────────\n'
    report += 'Player Position: (0, 0, 0)\n'
    report += 'Player Velocity: Constant forward at 4.0 m/s\n'
    report += 'Tick Rate: 60 TPS\n'
    report += 'Duration: 10 seconds per scenario\n'
    report += 'Kalman Filter Configuration:\n'
    report += '  - Position filters (X/Y/Z): Q=0.01-0.02, R=0.001\n'
    report += '  - Velocity filters (X/Y/Z): Q=0.05-0.1, R=0.002\n'
    report += '  - Rotation filter: Q=0.1, R=0.01\n\n'

    for (const scenario of this.results.scenarios) {
      const validation = this.validateThresholds(scenario)
      const statusIcon = validation.pass ? '✓ PASS' : '✗ FAIL'

      report += `\n${statusIcon} SCENARIO: ${scenario.name} (${Math.round(scenario.packetLossRate * 100)}% loss)\n`
      report += '─────────────────────────────────────────────────────────────────────────────\n'

      report += `Position Error (Max): ${scenario.metrics.maxPositionError.toFixed(4)} units\n`
      report += `Position Error (Avg): ${(scenario.metrics.errors.reduce((sum, e) => sum + e.error, 0) / scenario.metrics.errors.length).toFixed(4)} units\n`
      report += `Convergence Time: ${scenario.metrics.avgConvergenceTime.toFixed(2)} frames\n`
      report += `Stability: ${scenario.metrics.stability.isStable ? 'Stable' : 'UNSTABLE'}\n`
      report += `  - NaN detected: ${scenario.metrics.stability.hasNaN}\n`
      report += `  - Divergence: ${scenario.metrics.stability.hasDivergence}\n`
      report += `Playability: ${scenario.metrics.playability}\n`

      if (!validation.pass) {
        report += `\nValidation Failures:\n`
        for (const error of validation.errors) {
          report += `  - ${error}\n`
        }
      }
    }

    report += '\n\nOVERALL SUMMARY\n'
    report += '─────────────────────────────────────────────────────────────────────────────\n'

    const allPass = this.results.scenarios.every(s => this.validateThresholds(s).pass)
    const allStable = this.results.scenarios.every(s => s.metrics.stability.isStable)

    report += `All Scenarios Pass Thresholds: ${allPass ? 'YES' : 'NO'}\n`
    report += `All Filters Stable: ${allStable ? 'YES' : 'NO'}\n`

    const playabilityBreakdown = {}
    for (const scenario of this.results.scenarios) {
      const key = scenario.metrics.playability
      playabilityBreakdown[key] = (playabilityBreakdown[key] || 0) + 1
    }

    report += `\nPlayability Assessment:\n`
    for (const [level, count] of Object.entries(playabilityBreakdown)) {
      report += `  - ${level}: ${count} scenario(s)\n`
    }

    report += '\n═══════════════════════════════════════════════════════════════════════════════\n'
    report += 'ACCEPTANCE CRITERIA\n'
    report += '═══════════════════════════════════════════════════════════════════════════════\n'

    const criteria = [
      { test: 'No NaN or divergence', pass: allStable },
      { test: '10% loss: Error < 0.5 units, playable', pass: this.checkCriteria('10%', 0.5, 'playable') },
      { test: '25% loss: Error < 1.5 units, playable', pass: this.checkCriteria('25%', 1.5, 'playable') },
      { test: '50% loss: Error < 3.0 units, playable-but-noticeable', pass: this.checkCriteria('50%', 3.0, 'playable-but-noticeable') },
      { test: 'System remains stable', pass: allStable }
    ]

    for (const criterion of criteria) {
      const icon = criterion.pass ? '✓' : '✗'
      report += `${icon} ${criterion.test}\n`
    }

    report += '\n═══════════════════════════════════════════════════════════════════════════════\n'

    return report
  }

  checkCriteria(lossRate, maxError, minPlayability) {
    const scenario = this.results.scenarios.find(
      s => Math.round(s.packetLossRate * 100) === parseInt(lossRate)
    )
    if (!scenario) return false

    const errorPass = scenario.metrics.maxPositionError <= maxError
    const playPass = ['excellent', 'playable', 'playable-with-artifacts', 'playable-but-noticeable'].includes(
      scenario.metrics.playability
    )
    return errorPass && playPass
  }

  run() {
    const scenarios = [
      this.createScenario('10% Packet Loss (9/10 snapshots arrive)', 0.1, 10, 4.0),
      this.createScenario('25% Packet Loss (7.5/10 snapshots arrive)', 0.25, 10, 4.0),
      this.createScenario('50% Packet Loss (5/10 snapshots arrive)', 0.5, 10, 4.0)
    ]

    for (const scenario of scenarios) {
      this.runScenario(scenario)
      this.results.scenarios.push(scenario)
    }

    const report = this.generateReport()
    return { report, scenarios: this.results.scenarios }
  }
}

const test = new KalmanPacketLossTest()
const { report, scenarios } = test.run()

console.log(report)

console.log('\n\n═══════════════════════════════════════════════════════════════════════════════')
console.log('DETAILED METRICS BY SCENARIO')
console.log('═══════════════════════════════════════════════════════════════════════════════\n')

for (const scenario of scenarios) {
  console.log(`\n${scenario.name}`)
  console.log(`Max Position Error: ${scenario.metrics.maxPositionError.toFixed(6)} units`)
  console.log(`Average Position Error: ${(scenario.metrics.errors.reduce((sum, e) => sum + e.error, 0) / scenario.metrics.errors.length).toFixed(6)} units`)
  console.log(`Convergence Time: ${scenario.metrics.avgConvergenceTime.toFixed(2)} frames`)
  console.log(`Stability: ${scenario.metrics.stability.isStable ? 'PASS' : 'FAIL'}`)
  console.log(`Playability: ${scenario.metrics.playability}`)
}

export default KalmanPacketLossTest
