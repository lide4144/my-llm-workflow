# Snake Game (Authoritative Server) Design Specification

## 1. Architecture & Data Flow
*   **Architecture Pattern**: Authoritative Server. The Node.js server maintains the single source of truth for the game state. The React client is a "thin client" that only sends user input and renders the state received from the server.
*   **Communication Protocol**: WebSocket (Socket.io or native `ws`).
*   **Tick Rate**: The server game loop runs at 10 tick/s (updates and broadcasts every 100ms).

## 2. Server Design (Node.js + WebSocket)
*   **Game Loop**:
    *   Uses `setInterval` to trigger `update()` every 100ms.
    *   `update()` processes snake movement, food collision, wall collision, and snake-to-snake collision.
    *   Broadcasts the serialized game state (JSON) to all connected clients after the update.
*   **Game State**:
    *   `status`: `'WAITING'` | `'PLAYING'` | `'GAMEOVER'`.
    *   `players`: Dictionary mapping socket ID to `{ id, name, ready, isSpectator }`.
    *   `snakes`: Dictionary of snakes in the current round: `{ id, body: [{x, y}, ...], direction, color, isAlive }`.
    *   `food`: `{x, y}` coordinates of the current food.
    *   `gridSize`: Map dimensions (e.g., 30x30).
*   **Input Handling**:
    *   Listens for `DIRECTION_CHANGE` events from clients.
    *   Validates moves (e.g., cannot move `LEFT` if currently moving `RIGHT`). Inputs are buffered and applied on the next tick to prevent rapid self-collision within a single tick.
*   **Win/Loss & Spectator Mode**:
    *   Collisions (walls, own body, other snakes) mark `isAlive = false`.
    *   If alive snakes `<= 1` (and started with >= 2), state changes to `GAMEOVER`, surviving snake wins.
    *   Dead players become spectators. Late joiners during `'PLAYING'` also join as spectators.

## 3. Client Design (React)
*   **Rendering**:
    *   Canvas API or CSS Grid for rendering the 30x30 grid based purely on server state.
*   **Input Layer**:
    *   Captures WASD / Arrow keys.
    *   Sends `DIRECTION_CHANGE` immediately. No client-side prediction needed for a low-latency LAN 10 tick/s setup.
*   **UI States**:
    *   **Lobby**: Player list, Ready button.
    *   **Game**: Canvas, sidebar with player status/scores.
    *   **Spectator/Game Over**: Shows the winner, allows returning to lobby/re-readying.
*   **E2E Testing (Playwright) Selectors**:
    *   Must include `data-testid` on key elements: `btn-ready`, `player-list`, `game-board`, `winner-banner`.

## 4. Edge Cases
*   **Simultaneous Inputs**: Buffer single input per tick per player to avoid suicide loops.
*   **Disconnections**: If a player disconnects during `PLAYING`, their snake dies immediately.
*   **Ties**: Head-to-head collisions on the exact same tick result in simultaneous deaths (potential tie).
