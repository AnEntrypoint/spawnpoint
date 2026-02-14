export default {
  server: {
    setup(ctx) {
      ctx.state.testStartTime = null
      ctx.state.collisionEventLog = []
      ctx.state.playerDataLog = []
      ctx.state.testActive = false
      ctx.state.testConfig = {
        player_a_start: [0, 0, 0],
        player_b_start: [3, 0, 0],
        movement_speed: 2.0,
        collision_check_interval: 5
      }
    },

    update(ctx, dt) {
      if (!ctx.state.testActive) return

      const players = ctx.players.getAll()
      if (players.length < 2) return

      const playerA = players[0]
      const playerB = players[1]

      if (!playerA || !playerB || !playerA.state || !playerB.state) return

      const posA = playerA.state.position
      const posB = playerB.state.position
      const distXZ = Math.hypot(posB[0] - posA[0], posB[2] - posA[2])
      const capsuleRadius = 0.4
      const minDist = capsuleRadius * 2

      ctx.state.playerDataLog.push({
        tick: ctx.network.getTick(),
        time: (Date.now() - ctx.state.testStartTime) / 1000,
        playerA: {
          position: [...posA],
          velocity: [...playerA.state.velocity],
          onGround: playerA.state.onGround
        },
        playerB: {
          position: [...posB],
          velocity: [...playerB.state.velocity],
          onGround: playerB.state.onGround
        },
        distance: distXZ,
        collision: distXZ < minDist
      })

      if (distXZ < minDist && ctx.state.playerDataLog.length > 1) {
        const prevEntry = ctx.state.playerDataLog[ctx.state.playerDataLog.length - 2]
        if (prevEntry.distance >= minDist) {
          ctx.state.collisionEventLog.push({
            tick: ctx.network.getTick(),
            time: (Date.now() - ctx.state.testStartTime) / 1000,
            positionA: [...posA],
            positionB: [...posB],
            distance: distXZ
          })
        }
      }
    },

    onMessage(ctx, msg) {
      if (msg?.type === 'start_collision_test') {
        ctx.state.testActive = true
        ctx.state.testStartTime = Date.now()
        ctx.state.collisionEventLog = []
        ctx.state.playerDataLog = []

        const players = ctx.players.getAll()
        if (players.length >= 2) {
          ctx.players.setPosition(players[0].id, ctx.state.testConfig.player_a_start)
          ctx.players.setPosition(players[1].id, ctx.state.testConfig.player_b_start)
          players[0].state.velocity = [0, 0, 0]
          players[1].state.velocity = [0, 0, 0]
        }
      }

      if (msg?.type === 'get_collision_data') {
        ctx.players.send(msg.playerId, {
          type: 'collision_test_data',
          collisions: ctx.state.collisionEventLog,
          playerData: ctx.state.playerDataLog,
          active: ctx.state.testActive
        })
      }
    }
  },

  client: {
    setup(engine) {
      engine._collisionTest = null
    },

    onEvent(payload, engine) {
      if (payload.type === 'collision_test_data') {
        engine._collisionTest = payload
        console.log('[collision-test]', payload)
      }
    }
  }
}
