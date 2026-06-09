// backend/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mysql = require('mysql2');

const app = express();
app.use(cors());
app.use(express.json()); 

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ==========================================
// 🗄️ [MariaDB 연결 설정]
// ==========================================
const db = mysql.createConnection({
  host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'vending_db' 
});

db.connect((err) => {
  if (err) { console.error('❌ MariaDB 연결 실패', err); return; }
  console.log('🟩 MariaDB 데이터베이스 연결 성공!');
});

// 🔋 [로봇 상태 확장] 실시간 경로(path)와 장애물(obstacles) 배열 추가
let robotPosition = { 
  x: 50, y: 50, 
  status: 'IDLE', battery: 100, 
  currentProductId: null,
  path: [],        // 로봇이 따라갈 이동 경로 점들
  obstacles: []    // 로봇 센서가 감지한 가상 장애물들
};
let intervalId = null;

// 임의의 맵에 존재하는 고정 장애물 데이터 (로봇이 이 근처를 지날 때 감지하게 됨)
const MOCK_MAP_OBSTACLES = [
  { x: 120, y: 140 }, { x: 125, y: 140 }, { x: 130, y: 140 }, // 벽 1
  { x: 200, y: 250 }, { x: 205, y: 255 }, { x: 210, y: 260 }  // 벽 2
];

// ==========================================
// 🔐 [HTTP REST API]
// ==========================================
app.post('/api/signup', (req, res) => {
  const { userId, password, name } = req.body;
  if (!userId || !password || !name) return res.status(400).json({ success: false, message: '항목 누락' });
  const insertSql = 'INSERT INTO users (userId, password, name) VALUES (?, ?, ?)';
  db.query(insertSql, [userId, password, name], (err) => {
    if (err) return res.status(500).json({ success: false });
    return res.json({ success: true });
  });
});

app.post('/api/login', (req, res) => {
  const { userId, password } = req.body;
  const loginSql = 'SELECT id, userId, name, role FROM users WHERE userId = ? AND password = ?';
  db.query(loginSql, [userId, password], (err, results) => {
    if (results.length > 0) return res.json({ success: true, user: results[0] });
    return res.status(401).json({ success: false });
  });
});

app.get('/api/products', (req, res) => {
  db.query('SELECT * FROM products', (err, results) => res.json({ success: true, products: results }));
});

app.post('/api/products/restock', (req, res) => {
  db.query('UPDATE products SET stock = stock + 1 WHERE id = ?', [req.body.productId], () => res.json({ success: true }));
});

app.post('/api/products/add', (req, res) => {
  const { name, price, stock, icon } = req.body;
  db.query('INSERT INTO products (name, price, stock, icon) VALUES (?, ?, ?, ?)', [name, price, stock, icon], () => res.json({ success: true }));
});

app.post('/api/products/purchase-complete', (req, res) => {
  const productId = robotPosition.currentProductId;
  if (!productId) return res.status(400).json({ success: false });
  db.query('UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0', [productId], (err, results) => {
    if (results.affectedRows === 0) return res.status(400).json({ success: false });
    robotPosition.currentProductId = null;
    return res.json({ success: true });
  });
});

// ==========================================
// 🤖 [Socket.io] 로봇 제어 + ROS 가짜 데이터 시뮬레이션
// ==========================================
io.on('connection', (socket) => {
  console.log('클라이언트 연결:', socket.id);
  socket.emit('robot_position', robotPosition);

  socket.on('call_robot', (data) => {
    const { targetPos, productId } = data;
    if (intervalId) clearInterval(intervalId);
    
    robotPosition.status = 'MOVING';
    robotPosition.currentProductId = productId;

    // 🗺️ [가짜 ROS 경로 생성] 현재 위치에서 목적지까지 일직선 상의 5개 경유지(Path) 리스트를 미리 계산
    robotPosition.path = [];
    for (let i = 1; i <= 5; i++) {
      robotPosition.path.push({
        x: robotPosition.x + ((targetPos.x - robotPosition.x) * (i / 5)),
        y: robotPosition.y + ((targetPos.y - robotPosition.y) * (i / 5))
      });
    }

    io.emit('robot_position', robotPosition);

    intervalId = setInterval(() => {
      let dx = targetPos.x - robotPosition.x;
      let dy = targetPos.y - robotPosition.y;
      let distance = Math.sqrt(dx * dx + dy * dy);

      if (robotPosition.battery > 0) {
        robotPosition.battery = Math.max(0, Number((robotPosition.battery - 0.1).toFixed(1)));
      }

      // 🔍 [가짜 ROS 장애물 감지] 로봇 반경 60px 이내에 있는 장애물만 실시간 감지 레이더에 노출
      robotPosition.obstacles = MOCK_MAP_OBSTACLES.filter(obs => {
        let obsDist = Math.sqrt(Math.pow(obs.x - robotPosition.x, 2) + Math.pow(obs.y - robotPosition.y, 2));
        return obsDist < 60; 
      });

      if (distance < 5) {
        clearInterval(intervalId);
        robotPosition.x = targetPos.x;
        robotPosition.y = targetPos.y;
        robotPosition.status = 'ARRIVED'; 
        robotPosition.path = [];      // 도착 시 경로 지움
        robotPosition.obstacles = []; // 도착 시 장애물 감지 해제
        io.emit('robot_position', robotPosition);
      } else {
        robotPosition.x += (dx / distance) * 5;
        robotPosition.y += (dy / distance) * 5;
        
        // 이동하면서 남은 경로 갱신 시뮬레이션 (앞에 지나온 경로점 제거)
        robotPosition.path = robotPosition.path.filter(pt => {
          let ptDist = Math.sqrt(Math.pow(pt.x - robotPosition.x, 2) + Math.pow(pt.y - robotPosition.y, 2));
          return ptDist > 2; // 이미 지나친 점은 배열에서 제외
        });

        io.emit('robot_position', robotPosition);
      }
    }, 150);
  });
});

server.listen(4000, () => console.log('🚀 서버 가동 중 (포트 4000)'));