# Tomato CLI - Design Specification

## Overview
A Pomodoro CLI tool built with Node.js/TypeScript that features a bidirectional sync mechanism between a background terminal daemon and a local Web dashboard. It allows users to control their pomodoro sessions seamlessly from both the command line and a modern web interface.

## 1. Architecture & Data Flow

The system employs a client-server architecture running entirely on the user's local machine:

- **CLI Client (`tomato`)**: A lightweight executable parsing user commands (via Commander.js). It does not hold state. It communicates with the Daemon via local HTTP requests.
- **Daemon Service**: A background Node.js process (using standard detached process mechanisms). It serves three main purposes:
  1. Manages the core Pomodoro State Machine (Working, Paused, Break, Stopped).
  2. Runs a local HTTP server to host the static Web UI files and expose API endpoints for the CLI.
  3. Maintains a WebSocket server to stream state updates to the Web UI.
- **Web UI**: A lightweight Single Page Application (Vanilla JS / Preact). It renders the timer and provides control buttons.

**State Synchronization**:
All commands (from CLI or Web UI) route to the Daemon. The Daemon mutates the central state and immediately broadcasts the new state via WebSockets to all connected web clients.

## 2. CLI Commands

- `tomato start [minutes]`
  - Behavior: Starts a focus session. If the Daemon is not running, it spawns the daemon in the background, allocates an available port, saves connection info to a local temp file (e.g., `~/.tomato-cli/daemon.json`), and automatically opens the Web UI in the default browser.
- `tomato pause`: Pauses the active timer.
- `tomato resume`: Resumes a paused timer.
- `tomato stop`: Stops the timer and resets the state.
- `tomato status`: Prints the current timer status (e.g., `Focus: 14:32 remaining`) directly in the terminal without opening the browser.
- `tomato kill`: Terminates the background daemon process safely.

## 3. Web UI Design

- **Visuals**: Minimalist design with a large, central countdown timer.
- **Controls**: Primary action buttons (Start/Resume, Pause, Stop) positioned below the timer.
- **Feedback**: Dynamic styling (e.g., background color shifts) to distinguish between 'Focus' (red/orange) and 'Break' (green/blue) states.

## 4. End-to-End Testing Strategy (Playwright)

To ensure the bidirectional communication works flawlessly, Playwright will be used to orchestrate tests that involve both CLI execution and Web UI interaction.

**Test Scenarios & Required Screenshots**:
The tests will output screenshots to the `output_projects/tomato-cli/screenshots/` directory.

1. **Initial Load**:
   - Action: Spawn daemon via `tomato start 25`. Open Web UI in Playwright.
   - Assert: Timer displays `25:00`.
   - Artifact: `screenshot-initial-load.png`
2. **Web to Server Control**:
   - Action: Click the "Pause" button on the Web UI. Wait 2 seconds.
   - Assert: Timer value remains unchanged.
   - Artifact: `screenshot-web-paused.png`
3. **CLI to Web Sync**:
   - Action: Execute `tomato resume` via Node `exec` while Playwright monitors the page.
   - Assert: The Web UI updates to reflect the running state, and the timer starts ticking down.
   - Artifact: `screenshot-cli-resumed.png`
4. **Session Completion**:
   - Action: Start a mock short session (`tomato start 0.05` - approx 3 seconds). Wait for completion.
   - Assert: UI switches to the "Break" or "Finished" state.
   - Artifact: `screenshot-timer-finished.png`
