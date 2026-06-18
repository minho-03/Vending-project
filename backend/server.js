// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const mysql = require('mysql2');
const WebSocket = require('ws'); // 📡 ROSbridge 다이렉트 통신용 순수 웹소켓

const app = express();
app.use(cors());
app.use(express.json()); 
app.use('/assets', express.static(path.join(__dirname, 'assets')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const db = mysql.createConnection({
  host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'vending_db' 
});

db.connect((err) => {
  if (err) { console.error('❌ MariaDB 연결 실패', err); return; }
  console.log('🟩 MariaDB 데이터베이스 연결 성공!');
});

// 🔋 로봇 상태 객체 (앱과 실시간 공유될 관제 데이터의 단일 진실 공급원)
let robotPosition = { 
  x: 310, y: 350, 
  heading: -Math.PI / 2,
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

// 🚙 가상 주행 핵심 함수 (실제 로봇 구동 명령 연동 전 시뮬레이션 및 데이터 브로드캐스팅용)
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
/* 📡 --- ROSbridge 웹소켓 수동 다이렉트 연동부 --- */

const rosWs = new WebSocket('ws://192.168.0.51:9090');

rosWs.on('open', () => {
  console.log('🟩 [ROSbridge] 로봇 라즈베리파이와 백엔드 서버가 다이렉트로 연결되었습니다!');
  
  const subscribeMessage = {
    op: 'subscribe',
    topic: '/odom', // 현재 텔레옵 주행 중인 오돔 토픽
    type: 'nav_msgs/Odometry'
  };
  rosWs.send(JSON.stringify(subscribeMessage));
});

rosWs.on('message', (data) => {
  try {
    const rawData = JSON.parse(data);
    
    if (rawData.op === 'publish' && rawData.topic === '/odom') {
      const msg = rawData.msg;
      
      // 1. ROS 실제 지도 평면 좌표 (미터 단위)
      const rosX = msg.pose.pose.position.x;
      const rosY = msg.pose.pose.position.y;
      
      // 2. 쿼터니언 회전 구조값을 라디안(Heading 각도)으로 계산
      const q = msg.pose.pose.orientation;
      const heading = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
      
      // 3. 🗺️ [초정밀] YAML 기반 매핑 비례식 적용
      const RESOLUTION = 0.05;
      const ORIGIN_X = -10.0;
      const ORIGIN_Y = -10.0;
      const MAP_HEIGHT_PIXELS = 500; // 💡 기존 앱의 지도 이미지 픽셀 높이에 맞게 수정해 줘!
      
      // 공식 대입: 미터 좌표를 정확한 픽셀 좌표로 환산
      robotPosition.x = (rosX - ORIGIN_X) / RESOLUTION;
      robotPosition.y = MAP_HEIGHT_PIXELS - ((rosY - ORIGIN_Y) / RESOLUTION); // Y축 반전 보정
      robotPosition.heading = heading;
      
      // 디버깅용 실시간 로그 출력
      console.log(`📍 실시간 매핑 좌표 -> 앱 화면 X: ${robotPosition.x.toFixed(1)}px, Y: ${robotPosition.y.toFixed(1)}px`);
      
      // 4. 기존 디자인을 유지 중인 리액트 네이티브 앱으로 실시간 전송
      io.emit('robot_position', robotPosition);
    }
  } catch (err) {
    console.error("⚠️ [ROS 데이터 파싱 오류]:", err);
  }
});


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

// 🔄 음료 수령 완료 API -> 다중 선택 수량(quantity) 완벽 반영 및 일괄 인서트 처리
app.post('/api/products/purchase-complete', (req, res) => {
  const { productId, quantity } = req.body;
  
  const targetProductId = productId || robotPosition.currentProductId;
  const targetQuantity = parseInt(quantity, 10) || 1;

  if (!targetProductId) return res.status(400).json({ success: false, message: "상품 정보가 유실되었습니다." });
  
  db.query('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', [targetQuantity, targetProductId, targetQuantity], (err, results) => {
    if (err || results.affectedRows === 0) return res.status(400).json({ success: false, message: "재고가 부족하여 처리가 불가능합니다." });
    
    db.query('SELECT price FROM products WHERE id = ?', [targetProductId], (priceErr, priceResults) => {
      if (priceErr || priceResults.length === 0) return res.status(500).json({ success: false });
      
      const productPrice = priceResults[0].price;
      const bulkOrderData = [];
      for (let i = 0; i < targetQuantity; i++) {
        bulkOrderData.push([targetProductId, productPrice]);
      }

      db.query('INSERT INTO orders (product_id, price) VALUES ?', [bulkOrderData], (orderErr) => {
        if (orderErr) {
          console.error("❌ 주문 내역 인서트 중 오류 발생:", orderErr);
          return res.status(500).json({ success: false });
        }

        robotPosition.currentProductId = null;
        
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

/* --- 웹소켓(Socket.io) 파트 --- */

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

server.listen(4000, () => console.log('🚀 풀스택 대기열 & ROS 하이브리드 서버 가동 중 (포트 4000)'));