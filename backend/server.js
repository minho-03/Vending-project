// server.js
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
  x: 0, y: 0, 
  heading: 0,
  status: 'IDLE', // IDLE, MOVING, ARRIVED, RETURNING
  battery: 100, 
  currentProductId: null,
  path: [], obstacles: []
};
let intervalId = null;

// 📋 주문 대기열 시스템을 위한 배열 선언
let orderQueue = [];

const MOCK_MAP_OBSTACLES = [
  { x: 120, y: 140 }, { x: 125, y: 140 }, { x: 130, y: 140 },
  { x: 200, y: 250 }, { x: 205, y: 255 }, { x: 210, y: 260 }
];

// 🚙 로봇 주행 핵심 함수 (배달 및 복귀 공용 사용)
function driveRobotTo(targetPos, productId, isReturn = false) {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  robotPosition.status = isReturn ? 'RETURNING' : 'MOVING';
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
    if (robotPosition.status !== 'MOVING' && robotPosition.status !== 'RETURNING') {
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
      robotPosition.path = [];     
      robotPosition.obstacles = [];

      if (isReturn) {
        robotPosition.status = 'IDLE';
        console.log("🏠 로봇이 무사히 홈 기지에 복귀했습니다.");
        checkAndProcessQueue();
      } else {
        robotPosition.status = 'ARRIVED'; 
        console.log("📍 로봇이 목적지에 도착했습니다. 손님의 수령을 기다립니다.");
      }
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
}

// 📦 대기열 확인 및 다음 주문 처리 함수
function checkAndProcessQueue() {
  if (orderQueue.length > 0) {
    const nextOrder = orderQueue.shift(); 
    io.emit('queue_updated', orderQueue); 
    console.log(`🚀 대기열에서 주문을 꺼내 출발합니다! (남은 대기: ${orderQueue.length}개)`);
    driveRobotTo(nextOrder.targetPos, nextOrder.productId, false);
  }
}

/* --- API 라우터 파트 --- */

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

app.post('/api/products/delete', (req, res) => {
  const { productId } = req.body;
  db.query('DELETE FROM products WHERE id = ?', [productId], () => res.json({ success: true }));
});

// 🔄 [완전 수정] 음료 수령 완료 API -> 다중 선택 수량(quantity) 완벽 반영 및 일괄 인서트 처리
app.post('/api/products/purchase-complete', (req, res) => {
  // 프론트엔드가 body로 쏴준 내역을 명확하게 구조분해 할당으로 추출
  const { productId, quantity } = req.body;
  
  const targetProductId = productId || robotPosition.currentProductId;
  const targetQuantity = parseInt(quantity, 10) || 1; // 안전을 위해 정수 변환 및 기본값 방어

  if (!targetProductId) return res.status(400).json({ success: false, message: "상품 정보가 유실되었습니다." });
  
  // 1️⃣ 하드코딩된 'stock - 1' 대신 'stock - ?' 로 변경하고 보유 재고가 살 수량 이상인지 체크
  db.query('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', [targetQuantity, targetProductId, targetQuantity], (err, results) => {
    if (err || results.affectedRows === 0) return res.status(400).json({ success: false, message: "재고가 부족하여 처리가 불가능합니다." });
    
    // 2️⃣ orders 통계 테이블에 산 개수만큼 이력을 남기기 위해 단가(price)를 가져옴
    db.query('SELECT price FROM products WHERE id = ?', [targetProductId], (priceErr, priceResults) => {
      if (priceErr || priceResults.length === 0) return res.status(500).json({ success: false });
      
      const productPrice = priceResults[0].price;
      
      // 3️⃣ 구매 개수(targetQuantity)만큼 대량 인서트(Bulk Insert)를 위한 2차원 배열 데이터 가공
      // 예시 구조: [ [productId, price], [productId, price] ]
      const bulkOrderData = [];
      for (let i = 0; i < targetQuantity; i++) {
        bulkOrderData.push([targetProductId, productPrice]);
      }

      // mysql2의 대량 인서트 전용 문법 (VALUES ?) 연동
      db.query('INSERT INTO orders (product_id, price) VALUES ?', [bulkOrderData], (orderErr) => {
        if (orderErr) {
          console.error("❌ 주문 내역 인서트 중 오류 발생:", orderErr);
          return res.status(500).json({ success: false });
        }

        robotPosition.currentProductId = null;
        
        // 💡 배송 프로세스 종료 후 대기열 파이프라인 트리거
        if (orderQueue.length > 0) {
          checkAndProcessQueue();
        } else {
          console.log("💤 대기 주문이 없습니다. 홈 기지로 복귀합니다.");
          driveRobotTo({ x: 0, y: 0 }, null, true);
        }

        return res.json({ success: true });
      });
    });
  });
});

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

app.post('/api/admin/robot/force-reset', (req, res) => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  
  orderQueue = [];
  io.emit('queue_updated', orderQueue);

  robotPosition.x = 0;
  robotPosition.y = 0;
  robotPosition.heading = 0;
  robotPosition.status = 'IDLE';
  robotPosition.battery = 100;
  robotPosition.currentProductId = null;
  robotPosition.path = [];
  robotPosition.obstacles = [];

  io.emit('robot_position', robotPosition);
  console.log("🚨 [ADMIN COMMAND] 로봇 긴급 정지 및 주문 대기열 초기화 완료!");
  return res.json({ success: true });
});

/* --- 웹소켓 파트 --- */

io.on('connection', (socket) => {
  socket.emit('robot_position', robotPosition);
  socket.emit('queue_updated', orderQueue);

  socket.on('call_robot', (data) => {
    const { targetPos, productId } = data;
    const newOrder = { targetPos, productId };

    if (robotPosition.status === 'IDLE' || robotPosition.status === 'RETURNING') {
      console.log("🛒 로봇이 즉시 주문을 처리하러 출발합니다.");
      driveRobotTo(targetPos, productId, false);
    } else {
      orderQueue.push(newOrder);
      io.emit('queue_updated', orderQueue);
      console.log(`📋 로봇이 바쁩니다. 주문을 대기열에 추가합니다. (총 대기: ${orderQueue.length}개)`);
    }
  });
});

server.listen(4000, () => console.log('🚀 대기열 인텔리전트 서버 가동 중 (포트 4000)'));