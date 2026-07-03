# Snake Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 2-4 player authoritative-server Snake game with spectator support and Playwright E2E considerations.

**Architecture:** Node.js server maintains game state with a 10 tick/s loop, broadcasting updates to React clients via Socket.io. Clients capture input and render the server state.

**Tech Stack:** Node.js, Express, Socket.io, React (Vite), HTML5 Canvas.

## Global Constraints
- Target directory: `output_projects/snake-game/code/`
- Server port: `3001`
- Client port: `3000` (Vite default or configurable)
- Grid Size: `30x30`
- Tick Rate: `10 ticks per second` (100ms interval)

---

### Task 1: Server Scaffolding and Connection Logic

**Files:**
- Create: `output_projects/snake-game/code/snake-server/package.json`
- Create: `output_projects/snake-game/code/snake-server/server.js`

**Interfaces:**
- Produces: Running WebSocket server on port 3001, handles `connection`, `disconnect`, `ready` events.

- [ ] **Step 1: Initialize server project and dependencies**

```bash
mkdir -p output_projects/snake-game/code/snake-server
cd output_projects/snake-game/code/snake-server
npm init -y
npm install express socket.io cors
```

- [ ] **Step 2: Create server base structure**

Create `output_projects/snake-game/code/snake-server/server.js`:

```javascript
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

let gameState = {
  status: 'WAITING', // WAITING, PLAYING, GAMEOVER
  players: {},
  snakes: {},
  food: null,
  gridSize: { width: 30, height: 30 }
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  gameState.players[socket.id] = {
    id: socket.id,
    ready: false,
    isSpectator: false
  };
  
  socket.on('ready', () => {
    if (gameState.players[socket.id]) {
        gameState.players[socket.id].ready = true;
    }
    io.emit('stateUpdate', gameState);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    delete gameState.players[socket.id];
    delete gameState.snakes[socket.id];
    io.emit('stateUpdate', gameState);
  });
  
  // Initial state send
  socket.emit('stateUpdate', gameState);
});

server.listen(3001, () => {
  console.log('Snake Server running on port 3001');
});
```

- [ ] **Step 3: Run server to verify**

```bash
node output_projects/snake-game/code/snake-server/server.js &
```
(Expected: Console shows "Snake Server running on port 3001")


### Task 2: Server Game Loop & Logic

**Files:**
- Modify: `output_projects/snake-game/code/snake-server/server.js`

**Interfaces:**
- Consumes: User connections from Task 1.
- Produces: 10 tick/s updates handling movement, collision, win/loss conditions.

- [ ] **Step 1: Add input handling and game loop functions**

Modify `output_projects/snake-game/code/snake-server/server.js` to include the game loop:

```javascript
// ... existing imports and setup ...
// Add input queue
const inputQueue = {}; // { socketId: 'UP' }

function spawnFood() {
  let valid = false;
  let x, y;
  while (!valid) {
    x = Math.floor(Math.random() * gameState.gridSize.width);
    y = Math.floor(Math.random() * gameState.gridSize.height);
    valid = true;
    for (let id in gameState.snakes) {
      let snake = gameState.snakes[id];
      if (snake.isAlive && snake.body.some(segment => segment.x === x && segment.y === y)) {
        valid = false;
        break;
      }
    }
  }
  return { x, y };
}

function startGame() {
  gameState.status = 'PLAYING';
  gameState.snakes = {};
  let startY = 5;
  for (let id in gameState.players) {
    if (gameState.players[id].ready) {
      gameState.snakes[id] = {
        id,
        body: [{ x: 5, y: startY }, { x: 4, y: startY }, { x: 3, y: startY }],
        direction: 'RIGHT',
        isAlive: true
      };
      startY += 5;
      gameState.players[id].isSpectator = false;
    } else {
      gameState.players[id].isSpectator = true;
    }
  }
  gameState.food = spawnFood();
}

function gameLoop() {
  if (gameState.status !== 'PLAYING') return;

  let aliveCount = 0;
  
  // Process movement and collision
  for (let id in gameState.snakes) {
    let snake = gameState.snakes[id];
    if (!snake.isAlive) continue;

    // Apply input
    if (inputQueue[id]) {
      const currentDir = snake.direction;
      const nextDir = inputQueue[id];
      const isOpposite = 
        (currentDir === 'UP' && nextDir === 'DOWN') ||
        (currentDir === 'DOWN' && nextDir === 'UP') ||
        (currentDir === 'LEFT' && nextDir === 'RIGHT') ||
        (currentDir === 'RIGHT' && nextDir === 'LEFT');
      if (!isOpposite) {
        snake.direction = nextDir;
      }
      delete inputQueue[id];
    }

    // Calculate new head
    let head = { ...snake.body[0] };
    if (snake.direction === 'UP') head.y--;
    if (snake.direction === 'DOWN') head.y++;
    if (snake.direction === 'LEFT') head.x--;
    if (snake.direction === 'RIGHT') head.x++;

    // Wall collision
    if (head.x < 0 || head.x >= gameState.gridSize.width || head.y < 0 || head.y >= gameState.gridSize.height) {
      snake.isAlive = false;
      continue;
    }

    snake.body.unshift(head);

    // Food collision
    if (head.x === gameState.food.x && head.y === gameState.food.y) {
      gameState.food = spawnFood();
    } else {
      snake.body.pop(); // Remove tail if not eating
    }
  }

  // Self and other snake collision
  for (let id in gameState.snakes) {
    let snake = gameState.snakes[id];
    if (!snake.isAlive) continue;
    let head = snake.body[0];
    
    // Check against all snakes
    for (let otherId in gameState.snakes) {
      let otherSnake = gameState.snakes[otherId];
      if (!otherSnake.isAlive) continue;
      
      // Start from index 1 if checking against self, else 0
      let startIndex = (id === otherId) ? 1 : 0;
      for (let i = startIndex; i < otherSnake.body.length; i++) {
        if (head.x === otherSnake.body[i].x && head.y === otherSnake.body[i].y) {
          snake.isAlive = false;
          break;
        }
      }
    }
  }

  // Check win condition
  let totalPlayers = 0;
  for (let id in gameState.snakes) {
    totalPlayers++;
    if (gameState.snakes[id].isAlive) aliveCount++;
  }

  if (totalPlayers >= 2 && aliveCount <= 1) {
    gameState.status = 'GAMEOVER';
  }

  io.emit('stateUpdate', gameState);
}

setInterval(gameLoop, 100); // 10 tick/s

// Add to io.on('connection') inside server.js:
/*
  socket.on('direction', (dir) => {
    inputQueue[socket.id] = dir;
  });
  
  // also handle starting the game if everyone ready
  socket.on('ready', () => {
     //... 
     let allReady = Object.keys(gameState.players).length >= 2 && Object.values(gameState.players).every(p => p.ready);
     if (allReady && gameState.status === 'WAITING') {
       startGame();
     }
  });
*/
```

- [ ] **Step 2: Restart server**
Kill the old background process and restart `node output_projects/snake-game/code/snake-server/server.js`

### Task 3: Client Scaffolding and Network Connection

**Files:**
- Create: `output_projects/snake-game/code/snake-client/package.json`
- Create: `output_projects/snake-game/code/snake-client/src/App.jsx`

**Interfaces:**
- Consumes: WebSocket server on 3001.

- [ ] **Step 1: Scaffold React app**

```bash
cd output_projects/snake-game/code
npx create-vite@latest snake-client --template react
cd snake-client
npm install socket.io-client
```

- [ ] **Step 2: Basic App with Connection**

Modify `output_projects/snake-game/code/snake-client/src/App.jsx`:

```javascript
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001');

function App() {
  const [gameState, setGameState] = useState(null);

  useEffect(() => {
    socket.on('stateUpdate', (state) => {
      setGameState(state);
    });
    return () => socket.off('stateUpdate');
  }, []);

  if (!gameState) return <div>Connecting...</div>;

  return (
    <div>
      <h1>Snake LAN</h1>
      <div>Status: {gameState.status}</div>
      <button data-testid="btn-ready" onClick={() => socket.emit('ready')}>Ready</button>
      
      <div data-testid="player-list">
        <h3>Players:</h3>
        {Object.values(gameState.players).map(p => (
          <div key={p.id}>{p.id} {p.ready ? '(Ready)' : ''}</div>
        ))}
      </div>
    </div>
  );
}

export default App;
```

### Task 4: Client Rendering & Input

**Files:**
- Modify: `output_projects/snake-game/code/snake-client/src/App.jsx`

**Interfaces:**
- Consumes: `gameState` from socket.
- Produces: `DIRECTION_CHANGE` events.

- [ ] **Step 1: Canvas Rendering and Keyboard Input**

Update `App.jsx` to render the grid and capture input:

```javascript
import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001');
const CELL_SIZE = 15;

function App() {
  const [gameState, setGameState] = useState(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    socket.on('stateUpdate', setGameState);
    
    const handleKeyDown = (e) => {
      let dir = null;
      if (e.key === 'ArrowUp' || e.key === 'w') dir = 'UP';
      if (e.key === 'ArrowDown' || e.key === 's') dir = 'DOWN';
      if (e.key === 'ArrowLeft' || e.key === 'a') dir = 'LEFT';
      if (e.key === 'ArrowRight' || e.key === 'd') dir = 'RIGHT';
      if (dir) socket.emit('direction', dir);
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      socket.off('stateUpdate');
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!gameState || gameState.status !== 'PLAYING') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw food
    if (gameState.food) {
      ctx.fillStyle = 'red';
      ctx.fillRect(gameState.food.x * CELL_SIZE, gameState.food.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
    
    // Draw snakes
    for (let id in gameState.snakes) {
      const snake = gameState.snakes[id];
      ctx.fillStyle = snake.isAlive ? (id === socket.id ? 'blue' : 'green') : 'gray';
      snake.body.forEach(segment => {
        ctx.fillRect(segment.x * CELL_SIZE, segment.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      });
    }
  }, [gameState]);

  if (!gameState) return <div>Connecting...</div>;

  return (
    <div>
      <h1>Snake LAN</h1>
      <div>Status: {gameState.status}</div>
      {gameState.status === 'GAMEOVER' && (
        <h2 data-testid="winner-banner">Game Over!</h2>
      )}
      
      {gameState.status === 'WAITING' && (
        <>
          <button data-testid="btn-ready" onClick={() => socket.emit('ready')}>Ready</button>
          <div data-testid="player-list">
            {Object.values(gameState.players).map(p => (
              <div key={p.id}>{p.id} {p.ready ? '(Ready)' : ''}</div>
            ))}
          </div>
        </>
      )}

      {(gameState.status === 'PLAYING' || gameState.status === 'GAMEOVER') && (
         <canvas 
           ref={canvasRef} 
           width={gameState.gridSize.width * CELL_SIZE} 
           height={gameState.gridSize.height * CELL_SIZE} 
           style={{ border: '1px solid black' }}
           data-testid="game-board"
         />
      )}
    </div>
  );
}

export default App;
```
