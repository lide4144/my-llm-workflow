# 贪吃蛇多人对战 (Snake Game Multiplayer) - 设计文档

## 1. 架构概述
- **网络通信**: WebSocket (基于 `ws` 或 `socket.io`)
- **运行模式**: 局域网 (LAN) C/S 架构，**服务端完全权威 (Server-Authoritative)**。
- **游戏循环**: 服务端维护一个定时器，**10 tick/s** (每 100ms 更新一次状态并广播)。
- **同步策略**: **全量状态同步 (Full State Sync)**。由于局域网带宽充足且单局数据量极小，服务端每 tick 下发当前全量状态，客户端仅作为“纯渲染终端”。客户端无状态，不怕丢包。

## 2. 核心功能与玩法
- **玩家人数**: 2-4 人。
- **胜利条件**: 大逃杀模式 (Battle Royale)，撞墙、撞自己或撞其他蛇会死亡，**最后存活的蛇获胜**。
- **观战模式**: 支持玩家以观众身份加入房间，接收状态同步但不可发送控制指令。
- **游戏流程**:
  1. 玩家进入大厅，创建或加入房间（通过房间号）。
  2. 房间内满 2 人即可由房主/首个玩家点击“开始游戏”。
  3. 倒计时 3 秒后进入游玩状态。
  4. 游戏结束后展示结算面板（胜者），并可返回房间等待下一次开始。

## 3. 数据与状态设计

### 3.1 核心状态树 (Server Maintained)
```typescript
interface GameState {
  roomId: string;
  status: 'waiting' | 'countdown' | 'playing' | 'gameover';
  players: Record<string, Player>;
  spectators: string[]; // 观战者 WebSocket IDs
  food: { x: number, y: number }[];
  gridSize: { width: 20, height: 20 }; // 网格大小
}

interface Player {
  id: string; // 对应 ws 标识
  name: string;
  color: string;
  body: { x: number, y: number }[]; // 蛇身坐标，索引 0 为头
  direction: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'; // 当前行进方向
  nextDirection: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'; // 缓冲的下一帧输入
  isDead: boolean;
}
```

### 3.2 通信协议
- **Client -> Server**:
  - `join_room(roomId, mode: 'player' | 'spectator')`
  - `start_game()`
  - `input(direction)`: 仅改变 `nextDirection`，防止 1 tick 内多次按键导致“原地调头”自杀。
- **Server -> Client**:
  - `room_update(GameState)`: 房间人员变动时触发。
  - `tick(GameState)`: 游戏进行中，10 tick/s 高频广播。

## 4. 客户端 (React) 职责
- **UI 层**: 房间大厅界面、观战选项、结算弹窗。
- **渲染层**: 接收到 `tick` 数据后，直接将 `body` 映射为 Canvas 或 DOM 元素（使用 CSS Grid 或 Canvas 均可，推荐 Canvas 以获得更好的性能体验）。
- **输入层**: 监听键盘 `WASD` 或方向键，直接通过 WebSocket `emit('input', dir)` 发送，无需在本地做碰撞预判。

## 5. E2E 测试与截图验证策略 (Playwright)
因为包含局域网多人交互，E2E 测试需要同时启动多个 Browser Context 来模拟多个玩家/观战者。

**核心测试场景与截图验证点**:
1. **大厅与房间系统**: 
   - 验证：玩家 A 创建房间，玩家 B 输入房间号成功加入。
   - 📸 **截图点**: 房间内的等待列表界面 (Waiting Room)。
2. **多开与状态同步**:
   - 验证：主控端开启游戏，两个端均看到 3 秒倒计时。
   - 📸 **截图点**: 游戏进行中画面 (Game Grid rendering)，包含两条不同颜色的蛇和食物。
3. **碰撞与淘汰逻辑**:
   - 验证：模拟某一方蛇撞墙，该玩家变灰或消失。
   - 📸 **截图点**: 结算画面 (Game Over Screen)，需清晰展示获胜者提示。
4. **观战模式 (Spectator View)**:
   - 验证：玩家 C 作为观战者加入，无法控制，但能实时看到场上蛇的移动。
   - 📸 **截图点**: 观战者视角的 UI（包含明显的 "Spectating" 提示，隐藏操控按钮）。

## 6. 后续工程划分
1. **Server端**: WebSocket 房间管理 + 游戏主循环 (Tick Loop) + 碰撞系统。
2. **Client端**: React 路由/状态 + WebSocket 客户端 (Zustand 或 Context) + Canvas 渲染引擎。
3. **E2E端**: Playwright 测试脚本。