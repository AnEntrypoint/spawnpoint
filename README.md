# Spawnpoint

Multiplayer game server SDK. 128 TPS authoritative server, Jolt Physics WASM, WebSocket transport, hot reload.

## Quick Start
 
```bash
npm install
node server.js
# http://localhost:8080
```

## Architecture

```
server.js                    Entry point, calls boot()
src/sdk/server.js            Creates all subsystems, wires them together
src/sdk/TickHandler.js       Per-tick: movement -> physics -> collisions -> app tick -> snapshot
src/sdk/ReloadManager.js     File watchers for SDK hot reload
src/apps/AppRuntime.js       Entity system, app lifecycle, timers, collision events
src/apps/AppLoader.js        Loads apps from apps/ directory, validates, watches for changes
src/physics/World.js          Jolt Physics wrapper (bodies, characters, raycasts)
src/netcode/PhysicsIntegration.js  CharacterVirtual per player, gravity application
src/connection/ConnectionManager.js  WebSocket client management, heartbeat, msgpack encode/decode
src/protocol/msgpack.js       Hand-rolled msgpack encoder/decoder
client/app.js                Three.js renderer, VRM loading, entity rendering, input loop
```

## World Config

`apps/world/index.js` exports the world definition:

```javascript
export default {
  port: 8080,
  tickRate: 128,
  gravity: [0, -9.81, 0],
  movement: { maxSpeed: 4.0, groundAccel: 10.0, airAccel: 1.0, friction: 6.0, stopSpeed: 2.0, jumpImpulse: 4.0 },
  player: { health: 100, capsuleRadius: 0.4, capsuleHalfHeight: 0.9, mass: 120, modelScale: 1.323, feetOffset: 0.212 },
  scene: { skyColor: 0x87ceeb, sunColor: 0xffffff, sunIntensity: 1.5, sunPosition: [21, 50, 20] },
  camera: { fov: 70, shoulderOffset: 0.35, zoomStages: [0, 1.5, 3, 5, 8], defaultZoomIndex: 2 },
  animation: { mixerTimeScale: 1.3, walkTimeScale: 2.0, sprintTimeScale: 0.56, fadeTime: 0.15 },
  entities: [
    { id: 'environment', model: './apps/tps-game/schwust.glb', position: [0, 0, 0], app: 'environment' },
    { id: 'game', position: [0, 0, 0], app: 'tps-game' }
  ],
  playerModel: './apps/tps-game/Cleetus.vrm',
  spawnPoint: [-35, 3, -65]
}
```

## Creating Apps

Create `apps/<name>/index.js`:

```javascript
export default {
  server: {
    setup(ctx) {
      // Called once on spawn and on hot reload
      // ctx.state persists across hot reloads
      ctx.state.counter = ctx.state.counter || 0
    },
    update(ctx, dt) {
      // Called every tick (128/sec)
      ctx.state.counter += dt
    },
    teardown(ctx) {
      // Called on destroy or before hot reload
    },
    onMessage(ctx, msg) {
      // Receives player_join, player_leave, fire, and custom APP_EVENT messages
      if (msg.type === 'player_join') { /* ... */ }
    },
    onInteract(ctx, player) {
      // Called when client sends APP_EVENT with this entity's ID
    },
    onCollision(ctx, other) {
      // Called when this entity's collider overlaps another entity's collider
    }
  },
  client: {
    setup(engine) {
      // engine.scene, engine.camera, engine.renderer, engine.THREE, engine.client, engine.cam
    },
    render(ctx) {
      // Return visual state. ctx.entity, ctx.state, ctx.h (createElement), ctx.engine, ctx.players
      return {
        position: ctx.entity.position,
        custom: { mesh: 'box', color: 0xff0000, sx: 1, sy: 1, sz: 1 },
        ui: ctx.h('div', {}, 'Hello')
      }
    },
    onInput(input, engine) { },
    onFrame(dt, engine) { },
    onEvent(payload, engine) { },
    onMouseDown(e, engine) { },
    onMouseUp(e, engine) { }
  }
}
```

## Server-Side ctx API

| Property | Description |
|---|---|
| `ctx.state` | Persistent state object (survives hot reload) |
| `ctx.entity` | Entity proxy: `.id`, `.position`, `.rotation`, `.scale`, `.velocity`, `.custom`, `.destroy()` |
| `ctx.physics` | `.addBoxCollider(size)`, `.addSphereCollider(r)`, `.addCapsuleCollider(r, h)`, `.addTrimeshCollider()`, `.setDynamic(bool)`, `.addForce(vec3)`, `.setVelocity(vec3)` |
| `ctx.world` | `.spawn(id, cfg)`, `.destroy(id)`, `.attach(eid, app)`, `.getEntity(id)`, `.query(filter)`, `.nearby(pos, radius)` |
| `ctx.players` | `.getAll()`, `.getNearest(pos, r)`, `.send(pid, msg)`, `.broadcast(msg)`, `.setPosition(pid, pos)` |
| `ctx.time` | `.tick`, `.deltaTime`, `.elapsed`, `.after(sec, fn)`, `.every(sec, fn)` |
| `ctx.bus` | `.on(channel, fn)`, `.emit(channel, data)`, `.once(channel, fn)`, `.handover(targetEntityId, state)` |
| `ctx.network` | `.broadcast(msg)`, `.sendTo(id, msg)` |
| `ctx.storage` | `.get(key)`, `.set(key, val)`, `.delete(key)`, `.list(prefix)`, `.has(key)` |
| `ctx.config` | Entity config passed from world definition |
| `ctx.raycast(origin, dir, maxDist)` | Physics raycast against world geometry |

## Client Engine API

| Property | Description |
|---|---|
| `engine.scene` | THREE.Scene |
| `engine.camera` | THREE.PerspectiveCamera |
| `engine.renderer` | THREE.WebGLRenderer |
| `engine.THREE` | Three.js module |
| `engine.client` | PhysicsNetworkClient instance |
| `engine.playerId` | Local player ID |
| `engine.cam` | Camera controller: `.yaw`, `.pitch`, `.getAimDirection(pos)`, `.setMode(m)`, `.applyConfig(cfg)` |
| `engine.players` | `.getMesh(id)`, `.getState(id)`, `.getAnimator(id)`, `.setExpression(id, name, val)` |
| `engine.createElement` | webjsx createElement for UI |

## Entity Custom Mesh Properties

When an entity has no `model`, the client builds geometry from `entity.custom`:

| Field | Description |
|---|---|
| `mesh` | `'box'` (default), `'cylinder'`, `'sphere'` |
| `color` | Hex color (default 0xff8800) |
| `sx, sy, sz` | Box dimensions |
| `r` | Radius for sphere/cylinder |
| `h` | Height for cylinder |
| `spin` | Y-axis rotation speed (radians/sec) |
| `hover` | Vertical bob amplitude |
| `light` | PointLight color |
| `lightIntensity, lightRange` | PointLight params |
| `emissive, emissiveIntensity` | Material emissive |

## EventBus Channels

Apps communicate via `ctx.bus`:

```javascript
// Publisher
ctx.bus.emit('combat.fire', { shooterId, origin, direction })

// Subscriber (supports wildcard)
ctx.bus.on('combat.*', (event) => {
  // event.channel, event.data, event.meta.sourceEntity, event.meta.timestamp
})
```

Scoped subscriptions auto-cleanup on entity destroy/hot reload.

## Dependencies

- `jolt-physics` - WASM physics engine
- `ws` - WebSocket server
- `webjsx` - JSX-like DOM diffing for client UI
- `d3-octree` - Spatial indexing

## Testing

### W4-024: Player-Player Collision Test (60 TPS)

Validates custom player-player collision detection at 60 TPS.

```bash
node test-w4-024-final.mjs
```

**Setup:**
- Player A spawns at [0, 0, 0], walks right (+X)
- Player B spawns at [3, 0, 0], walks left (-X)
- Both accelerate toward each other at ~2.0 m/s
- Expected collision at ~0.75 seconds

**System Under Test:**
- `src/sdk/TickHandler.js` lines 64-88: Collision separation loop
- `src/netcode/PhysicsIntegration.js` lines 97-118: Distance-based detection

**Collision Parameters:**
- Capsule radius: 0.4 units per player
- Min collision distance: 0.8 units (2 × radius)
- Separation: 50% overlap per player
- Max separation velocity: 3.0 m/s

**Acceptance Criteria (all must pass):**
1. Collision detected at correct distance (< 0.8 units)
2. Time to collision reasonable (0.55 - 0.95 seconds)
3. Separation response active (max penetration < 0.2 units)
4. No excessive oscillation (< 5 transitions)
5. Both players remain stable (onGround = true)
6. Collision threshold respected

**Test Files:**
- `test-w4-024-final.mjs` - Main collision test (recommended)
- `test-w4-024-sim.mjs` - Alternative with physics simulation
- `test-w4-024.mjs` - Basic version
- `apps/collision-test/index.js` - Test app for browser-based testing

**Output Example:**
```
[W4-024] Player-Player Collision Test at 60 TPS
======================================================================
[COLLISION] Detected at frame 45 (t=0.750s) distance=0.798u
[VALIDATION]
============
[PASS] Collision detected
[PASS] At correct distance (< 0.8u)
[PASS] Time reasonable (0.55-0.95s)
[PASS] Low penetration (< 0.2u)
[PASS] No excessive collision (<50% time)

======================================================================
OVERALL: PASS
======================================================================
```

**Physics Notes:**
- Movement: Quake-style friction + air acceleration
- Y velocity: from gravity/physics
- XZ velocity: from input (capped at maxSpeed = 4.0 m/s)
- Collision runs AFTER physics.step() to separate penetrating players
- Separated Set prevents double-processing same pair

## License

MIT
