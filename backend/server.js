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
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const db = mysql.createConnection({
  host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'vending_db' 
});

db.connect((err) => {
  if (err) { console.error('❌ MariaDB 연결 실패', err); return; }
  console.log('🟩 MariaDB 데이터베이스 연결 성공!');
});

// 🔋 [로봇 상태 확장] heading(바라보는 각도) 추가됨!
let robotPosition = { 
  x: 50, y: 50, 
  heading: 0,      // 🧭 추가됨: 로봇이 바라보는 방향 (라디안 각도)
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

// 🥤 [수정됨] 음료 수령 완료 시 -> 재고를 깎고 판매 이력(orders) 테이블에 동시에 저장
app.post('/api/products/purchase-complete', (req, res) => {
  const productId = robotPosition.currentProductId;
  if (!productId) return res.status(400).json({ success: false });
  
  db.query('UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0', [productId], (err, results) => {
    if (results.affectedRows === 0) return res.status(400).json({ success: false });
    
    // 📊 [신규 로직] 해당 상품 정보를 서브쿼리로 읽어와서 orders 테이블에 한 줄 쌓기
    db.query('INSERT INTO orders (product_id, price) SELECT id, price FROM products WHERE id = ?', [productId], (orderErr) => {
      if (orderErr) console.error('❌ 판매 이력 누계 오류:', orderErr);
      
      robotPosition.currentProductId = null;
      return res.json({ success: true });
    });
  });
});

// 📊 [신규 추가] 관리자 전용 통계 데이터 조회 API (총 매출액, 최다 판매 음료)
app.get('/api/admin/stats', (req, res) => {
  // 1. 총 매출액 합산 쿼리
  db.query('SELECT IFNULL(SUM(price), 0) AS total_revenue FROM orders', (err, revResults) => {
    if (err) return res.status(500).json({ success: false });
    const totalRevenue = revResults[0].total_revenue;

    // 2. 가장 많이 팔린 음료 Top 1 쿼리
    db.query(`
      SELECT p.name, COUNT(o.id) AS sales_count 
      FROM orders o 
      JOIN products p ON o.product_id = p.id 
      GROUP BY o.product_id 
      ORDER BY sales_count DESC 
      LIMIT 1
    `, (err, bestResults) => {
      if (err) return res.status(500).json({ success: false });
      
      const bestSeller = bestResults.length > 0 
        ? `${bestResults[0].name} (${bestResults[0].sales_count}개)` 
        : '아직 없음';
        
      return res.json({ success: true, totalRevenue, bestSeller });
    });
  });
});

// 🚨 [신규 추가] 관리자 전용 로봇 시스템 강제 제어 및 홈 복귀 API
app.post('/api/admin/robot/force-reset', (req, res) => {
  // 주행 중이던 인터벌 스케줄러가 있다면 완벽히 파괴
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  
  // 로봇의 모든 상태값을 태초의 상태(대기중, 배터리 100%, 50px,50px 좌표)로 즉시 초기화
  robotPosition = { 
    x: 50, y: 50, 
    heading: 0,
    status: 'IDLE', battery: 100, 
    currentProductId: null,
    path: [], obstacles: []
  };

  // 실시간으로 관제 중인 모든 클라이언트(유저 지도 뷰어 등)에 전송하여 강제 동기화
  io.emit('robot_position', robotPosition);
  console.log("🚨 [ADMIN COMMAND] 로봇이 관리자에 의해 강제 리셋 및 복귀되었습니다.");
  return res.json({ success: true });
});

io.on('connection', (socket) => {
  socket.emit('robot_position', robotPosition);

  socket.on('call_robot', (data) => {
    const { targetPos, productId } = data;
    if (intervalId) clearInterval(intervalId);
    
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
      let dx = targetPos.x - robotPosition.x;
      let dy = targetPos.y - robotPosition.y;
      let distance = Math.sqrt(dx * dx + dy * dy);

      // 🧭 [추가됨] 목적지를 향하는 각도(Heading) 계산
      if (distance > 0.5) {
        robotPosition.heading = Math.atan2(dy, dx);
      }

      if (robotPosition.battery > 0) robotPosition.battery = Math.max(0, Number((robotPosition.battery - 0.1).toFixed(1)));

      robotPosition.obstacles = MOCK_MAP_OBSTACLES.filter(obs => {
        let obsDist = Math.sqrt(Math.pow(obs.x - robotPosition.x, 2) + Math.pow(obs.y - robotPosition.y, 2));
        return obsDist < 60; 
      });

      if (distance < 5) {
        clearInterval(intervalId);
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