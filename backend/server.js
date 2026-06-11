const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mysql = require('mysql2');

const app = express();
app.use(cors());
app.use(express.json()); 

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const db = mysql.createConnection({
  host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'vending_db' 
});

db.connect((err) => {
  if (err) { console.error('❌ MariaDB 연결 실패', err); return; }
  console.log('🟩 MariaDB 데이터베이스 연결 성공!');
});

// 🔋 로봇 상태 객체
let robotPosition = { 
  x: 50, y: 50, 
  heading: 0,
  status: 'IDLE', battery: 100, 
  currentProductId: null,
  path: [], obstacles: []
};
let intervalId = null;

const MOCK_MAP_OBSTACLES = [
  { x: 120, y: 140 }, { x: 125, y: 140 }, { x: 130, y: 140 },
  { x: 200, y: 250 }, { x: 205, y: 255 }, { x: 210, y: 260 }
];

app.post('/api/signup', (req, res) => {
  const { userId, password, name } = req.body;
  db.query('INSERT INTO users (userId, password, name) VALUES (?, ?, ?)', [userId, password, name], (err) => {
    if (err) return res.status(500).json({ success: false });
    return res.json({ success: true });
  });
});

app.post('/api/login', (req, res) => {
  const { userId, password } = req.body;
  db.query('SELECT id, userId, name, role FROM users WHERE userId = ? AND password = ?', [userId, password], (err, results) => {
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

// 🗑️ [누락 수정 1] 상품 완전히 삭제하는 API 추가
app.post('/api/products/delete', (req, res) => {
  const { productId } = req.body;
  db.query('DELETE FROM products WHERE id = ?', [productId], (err, results) => {
    if (err) {
      console.error('삭제 오류:', err);
      return res.status(500).json({ success: false, message: 'DB 오류' });
    }
    return res.json({ success: true });
  });
});

// 음료 수령 완료 -> 판매 이력 적재
app.post('/api/products/purchase-complete', (req, res) => {
  const productId = robotPosition.currentProductId;
  if (!productId) return res.status(400).json({ success: false });
  
  db.query('UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0', [productId], (err, results) => {
    if (results.affectedRows === 0) return res.status(400).json({ success: false });
    
    db.query('INSERT INTO orders (product_id, price) SELECT id, price FROM products WHERE id = ?', [productId], (orderErr) => {
      robotPosition.currentProductId = null;
      return res.json({ success: true });
    });
  });
});

// 통계 데이터 조회 API
app.get('/api/admin/stats', (req, res) => {
  db.query('SELECT IFNULL(SUM(price), 0) AS total_revenue FROM orders', (err, revResults) => {
    if (err) return res.status(500).json({ success: false });
    const totalRevenue = revResults[0].total_revenue;

    db.query(`
      SELECT p.name, COUNT(o.id) AS sales_count 
      FROM orders o 
      JOIN products p ON o.product_id = p.id 
      GROUP BY o.product_id 
      ORDER BY sales_count DESC 
      LIMIT 1
    `, (err, bestResults) => {
      if (err) return res.status(500).json({ success: false });
      const bestSeller = bestResults.length > 0 ? `${bestResults[0].name} (${bestResults[0].sales_count}개)` : '기록 없음';
      return res.json({ success: true, totalRevenue, bestSeller });
    });
  });
});

// 🚨 [동작 수정 2] 강제 리셋 API 보완 (참조 꼬임 방지)
app.post('/api/admin/robot/force-reset', (req, res) => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  
  // 새 객체를 덮어씌우지 않고 내부 속성값만 확실하게 초기화 (좀비 주행 완벽 차단)
  robotPosition.x = 50;
  robotPosition.y = 50;
  robotPosition.heading = 0;
  robotPosition.status = 'IDLE';
  robotPosition.battery = 100;
  robotPosition.currentProductId = null;
  robotPosition.path = [];
  robotPosition.obstacles = [];

  io.emit('robot_position', robotPosition);
  console.log("🚨 [ADMIN COMMAND] 로봇 강제 리셋 및 초기 위치 복귀 완료!");
  return res.json({ success: true });
});

io.on('connection', (socket) => {
  socket.emit('robot_position', robotPosition);

  socket.on('call_robot', (data) => {
    const { targetPos, productId } = data;
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    
    robotPosition.status = 'MOVING';
    robotPosition.currentProductId = productId;
    robotPosition.path = [];
    
    for (let i = 1; i <= 5; i++) {
      robotPosition.path.push({
        x: robotPosition.x + ((targetPos.x - robotPosition.x) * (i / 5)),
        y: robotPosition.y + ((targetPos.y - robotPosition.y) * (i / 5))
      });
    }

    io.emit('robot_position', robotPosition);

    intervalId = setInterval(() => {
      // 로봇 상태가 MOVING이 아니면 (강제 리셋을 당했으면) 스스로 인터벌 즉시 종료
      if (robotPosition.status !== 'MOVING') {
        clearInterval(intervalId);
        intervalId = null;
        return;
      }

      let dx = targetPos.x - robotPosition.x;
      let dy = targetPos.y - robotPosition.y;
      let distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > 0.5) robotPosition.heading = Math.atan2(dy, dx);
      if (robotPosition.battery > 0) robotPosition.battery = Math.max(0, Number((robotPosition.battery - 0.1).toFixed(1)));

      robotPosition.obstacles = MOCK_MAP_OBSTACLES.filter(obs => {
        let obsDist = Math.sqrt(Math.pow(obs.x - robotPosition.x, 2) + Math.pow(obs.y - robotPosition.y, 2));
        return obsDist < 60; 
      });

      if (distance < 5) {
        clearInterval(intervalId);
        intervalId = null;
        robotPosition.x = targetPos.x;
        robotPosition.y = targetPos.y;
        robotPosition.status = 'ARRIVED'; 
        robotPosition.path = [];     
        robotPosition.obstacles = [];
        io.emit('robot_position', robotPosition);
      } else {
        robotPosition.x += (dx / distance) * 5;
        robotPosition.y += (dy / distance) * 5;
        robotPosition.path = robotPosition.path.filter(pt => {
          return Math.sqrt(Math.pow(pt.x - robotPosition.x, 2) + Math.pow(pt.y - robotPosition.y, 2)) > 2;
        });
        io.emit('robot_position', robotPosition);
      }
    }, 150);
  });
});

server.listen(4000, () => console.log('🚀 서버 가동 중 (포트 4000)'));