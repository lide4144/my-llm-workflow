# Snake Game Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a LAN-based multiplayer Snake game with server-authoritative logic, 10 tick/s full state sync, and E2E Playwright tests.

**Architecture:** Node.js WebSocket server maintaining authoritative game state, React frontend acting as a pure renderer, and Playwright for E2E multiplayer testing.

**Tech Stack:** Node.js, `ws`, React (Vite), Zustand, Canvas/CSS Grid, Playwright.

## Global Constraints

- Output must strictly follow the directory structure: `output_projects/snake-game/code/` and `output_projects/snake-game/screenshots/`.
- 10 tick/s update loop on the server.
- Full state sync (server sends complete game state every tick).
- Clients do NOT calculate game state; they only send inputs (`WASD`/arrows) and render state.

---

### Task 1: Server - Core Game Engine (Logic)

**Files:**
- Create: `output_projects/snake-game/code/snake-server/game.js`
- Create: `output_projects/snake-game/code/snake-server/tests/game.test.js`

**Interfaces:**
- Produces: `class GameEngine`, methods `addPlayer(id)`, `removePlayer(id)`, `setInput(id, dir)`, `tick()`, `getState()`

- [ ] **Step 1: Write the failing test**

```javascript
// output_projects/snake-game/code/snake-server/tests/game.test.js
const assert = require('assert');
const GameEngine = require('../game.js');

const game = new GameEngine('room1');
game.addPlayer('p1');
const state = game.getState();
assert.strictEqual(state.players['p1'].id, 'p1');
assert.strictEqual(state.players['p1'].body.length, 3);
console.log('Task 1 Test 1 Passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node output_projects/snake-game/code/snake-server/tests/game.test.js`
Expected: FAIL with "Cannot find module '../game.js'"

- [ ] **Step 3: Write minimal implementation**

```javascript
// output_projects/snake-game/code/snake-server/game.js
class GameEngine {
  constructor(roomId) {
    this.roomId = roomId;
    this.status = 'waiting';
    this.players = {};
    this.spectators = [];
    this.food = [];
    this.gridSize = { width: 30, height: 30 };
  }

  addPlayer(id) {
    this.players[id] = {
      id,
      body: [{x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7}],
      direction: 'UP',
      nextDirection: 'UP',
      isDead: false
    };
  }

  getState() {
    return {
      roomId: this.roomId,
      status: this.status,
      players: this.players,
      spectators: this.spectators,
      food: this.food,
      gridSize: this.gridSize
    };
  }
}
module.exports = GameEngine;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node output_projects/snake-game/code/snake-server/tests/game.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd output_projects/snake-game/code/snake-server
git add .
git commit -m "feat: core game engine state and player tracking"
```

---

### Task 2: Server - Tick Logic & Movement (TDD)

**Files:**
- Modify: `output_projects/snake-game/code/snake-server/tests/game.test.js`
- Modify: `output_projects/snake-game/code/snake-server/game.js`

**Interfaces:**
- Consumes: `GameEngine` state methods
- Produces: Movement logic, food generation, boundary collision

- [ ] **Step 1: Write the failing test for tick movement**

```javascript
// Append to output_projects/snake-game/code/snake-server/tests/game.test.js
game.status = 'playing';
game.tick(); // Should move 'p1' UP (y decreases)
const movedState = game.getState();
assert.strictEqual(movedState.players['p1'].body[0].y, 4);
console.log('Task 2 Test Passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node output_projects/snake-game/code/snake-server/tests/game.test.js`
Expected: FAIL "game.tick is not a function"

- [ ] **Step 3: Write minimal implementation**

```javascript
// Add to GameEngine class in game.js
  setInput(id, dir) {
    if (this.players[id]) this.players[id].nextDirection = dir;
  }

  tick() {
    if (this.status !== 'playing') return;
    
    // Move players
    Object.values(this.players).forEach(p => {
      if (p.isDead) return;
      p.direction = p.nextDirection;
      const head = { ...p.body[0] };
      
      if (p.direction === 'UP') head.y -= 1;
      if (p.direction === 'DOWN') head.y += 1;
      if (p.direction === 'LEFT') head.x -= 1;
      if (p.direction === 'RIGHT') head.x += 1;

      // Simple collision with walls
      if (head.x < 0 || head.x >= this.gridSize.width || head.y < 0 || head.y >= this.gridSize.height) {
        p.isDead = true;
        return;
      }

      p.body.unshift(head);
      p.body.pop(); // Remove tail
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node output_projects/snake-game/code/snake-server/tests/game.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd output_projects/snake-game/code/snake-server
git add .
git commit -m "feat: server tick movement and wall collision"
```

---

### Task 3: Server - WebSocket Setup

**Files:**
- Modify: `output_projects/snake-game/code/snake-server/server.js`

**Interfaces:**
- Consumes: `GameEngine`
- Produces: WS server on port 8080 listening to `join_room`, `start_game`, `input`

- [ ] **Step 1: Install dependencies**
Run: `cd output_projects/snake-game/code/snake-server && npm install ws`

- [ ] **Step 2: Write WebSocket server logic**

```javascript
// output_projects/snake-game/code/snake-server/server.js
const { WebSocketServer } = require('ws');
const GameEngine = require('./game.js');

const wss = new WebSocketServer({ port: 8080 });
const rooms = {};

wss.on('connection', (ws) => {
  let currentRoom = null;
  let playerId = Math.random().toString(36).substring(7);

  ws.on('message', (message) => {
    const data = JSON.parse(message);

    if (data.type === 'join_room') {
      currentRoom = data.roomId;
      if (!rooms[currentRoom]) rooms[currentRoom] = new GameEngine(currentRoom);
      
      if (data.mode === 'player') rooms[currentRoom].addPlayer(playerId);
      else rooms[currentRoom].spectators.push(playerId);
      
      broadcast(currentRoom, { type: 'room_update', state: rooms[currentRoom].getState() });
    }

    if (data.type === 'start_game' && currentRoom) {
      rooms[currentRoom].status = 'playing';
      // Start loop
      if (!rooms[currentRoom].loopId) {
        rooms[currentRoom].loopId = setInterval(() => {
          rooms[currentRoom].tick();
          broadcast(currentRoom, { type: 'tick', state: rooms[currentRoom].getState() });
        }, 100); // 10 tick/s
      }
    }

    if (data.type === 'input' && currentRoom) {
      rooms[currentRoom].setInput(playerId, data.direction);
    }
  });

  ws.on('close', () => {
     // Clean up
  });
});

function broadcast(roomId, message) {
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(JSON.stringify(message));
  });
}

console.log('WS Server running on ws://localhost:8080');
```

- [ ] **Step 3: Test server starts**
Run: `node output_projects/snake-game/code/snake-server/server.js` (background or terminal tab)

- [ ] **Step 4: Commit**
```bash
git add .
git commit -m "feat: websocket server integration"
```

---

### Task 4: Client - React Scaffolding & Store

**Files:**
- Create: `output_projects/snake-game/code/snake-client` (via Vite)
- Create: `output_projects/snake-game/code/snake-client/src/store.js`

- [ ] **Step 1: Scaffold Vite App**
Run: 
```bash
cd output_projects/snake-game/code
npm create vite@latest snake-client -- --template react
cd snake-client
npm install
npm install zustand
```

- [ ] **Step 2: Create Zustand WebSocket Store**

```javascript
// output_projects/snake-game/code/snake-client/src/store.js
import { create } from 'zustand';

let ws;

export const useGameStore = create((set, get) => ({
  gameState: null,
  mode: 'player',
  connect: (roomId, mode) => {
    ws = new WebSocket('ws://localhost:8080');
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join_room', roomId, mode }));
      set({ mode });
    };
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'room_update' || data.type === 'tick') {
        set({ gameState: data.state });
      }
    };
  },
  startGame: () => ws.send(JSON.stringify({ type: 'start_game' })),
  sendInput: (direction) => ws && ws.send(JSON.stringify({ type: 'input', direction }))
}));
```

- [ ] **Step 3: Commit**
```bash
cd output_projects/snake-game/code/snake-client
git init
git add .
git commit -m "feat: react vite scaffold and websocket store"
```

---

### Task 5: Client - UI and Render Loop

**Files:**
- Modify: `output_projects/snake-game/code/snake-client/src/App.jsx`
- Modify: `output_projects/snake-game/code/snake-client/src/index.css`

- [ ] **Step 1: Write React Rendering Logic**

```jsx
// output_projects/snake-game/code/snake-client/src/App.jsx
import React, { useState, useEffect } from 'react';
import { useGameStore } from './store';

function App() {
  const [roomId, setRoomId] = useState('');
  const { gameState, mode, connect, startGame, sendInput } = useGameStore();

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowUp' || e.key === 'w') sendInput('UP');
      if (e.key === 'ArrowDown' || e.key === 's') sendInput('DOWN');
      if (e.key === 'ArrowLeft' || e.key === 'a') sendInput('LEFT');
      if (e.key === 'ArrowRight' || e.key === 'd') sendInput('RIGHT');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sendInput]);

  if (!gameState) {
    return (
      <div style={{ padding: 20 }}>
        <h1>Snake Multiplayer</h1>
        <input value={roomId} onChange={e => setRoomId(e.target.value)} placeholder="Room ID" />
        <button onClick={() => connect(roomId, 'player')}>Join as Player</button>
        <button onClick={() => connect(roomId, 'spectator')}>Spectate</button>
      </div>
    );
  }

  return (
    <div>
      <h2>Room: {gameState.roomId} - Status: {gameState.status}</h2>
      {gameState.status === 'waiting' && <button onClick={startGame}>Start Game</button>}
      
      <div style={{ position: 'relative', width: 600, height: 600, background: '#eee' }}>
        {Object.values(gameState.players).map(p => (
          !p.isDead && p.body.map((segment, i) => (
            <div key={`${p.id}-${i}`} style={{
              position: 'absolute',
              left: segment.x * 20,
              top: segment.y * 20,
              width: 20, height: 20,
              background: i === 0 ? 'darkgreen' : 'green'
            }} />
          ))
        ))}
      </div>
    </div>
  );
}

export default App;
```

- [ ] **Step 2: Commit**
```bash
git add .
git commit -m "feat: lobby UI and board rendering"
```

---

### Task 6: Playwright E2E Setup and Testing

**Files:**
- Create: `output_projects/snake-game/code/e2e-tests/`
- Create: `output_projects/snake-game/code/e2e-tests/tests/snake.spec.js`

- [ ] **Step 1: Install Playwright**
Run: 
```bash
cd output_projects/snake-game/code
mkdir e2e-tests
cd e2e-tests
npm init -y
npm install -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Write E2E multiplayer test**

```javascript
// output_projects/snake-game/code/e2e-tests/tests/snake.spec.js
const { test, expect } = require('@playwright/test');

test('Multiplayer Lobby and Game Start', async ({ browser }) => {
  // Player 1 Context
  const p1Context = await browser.newContext();
  const p1Page = await p1Context.newPage();
  
  // Player 2 Context
  const p2Context = await browser.newContext();
  const p2Page = await p2Context.newPage();

  // Note: assumes Vite running on 5173
  await p1Page.goto('http://localhost:5173');
  await p2Page.goto('http://localhost:5173');

  // P1 Creates Room
  await p1Page.fill('input', 'ROOM99');
  await p1Page.click('text=Join as Player');

  // P2 Joins Room
  await p2Page.fill('input', 'ROOM99');
  await p2Page.click('text=Join as Player');

  await expect(p1Page.locator('h2')).toContainText('Status: waiting');
  
  // Take Lobby Screenshot
  await p1Page.screenshot({ path: '../../../screenshots/lobby.png' });

  // P1 Starts Game
  await p1Page.click('text=Start Game');
  await expect(p1Page.locator('h2')).toContainText('Status: playing');

  // Take Game Screenshot
  await p1Page.screenshot({ path: '../../../screenshots/playing.png' });
});
```

- [ ] **Step 3: Commit**
```bash
git add .
git commit -m "test: add playwright e2e tests and screenshots"
```
