// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const mysql = require('mysql2');
const WebSocket = require('ws');
const { Client } = require('@stomp/stompjs');
Object.assign(global, { WebSocket: require('websocket').w3cwebsocket });

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

// 🔋 로봇 상태 객체
let robotPosition = { 
  x: 310, y: 350, 
  heading: -Math.PI / 2,
  status: 'IDLE',
  battery: 100, 
  currentProductId: null,
  path: [], obstacles: []
};
let intervalId = null;

// 📋 주문 대기열
let orderQueue = [];

// 🗺️ 좌표 변환 상수
const RESOLUTION = 0.05;
const ORIGIN_X = -10.0;
const ORIGIN_Y = -10.0;
const MAP_HEIGHT_PIXELS = 384;
const OFFSET_X = 190;
const OFFSET_Y = 127;

// 🏠 홈 기지 픽셀 좌표
const HOME_POS = { x: 200 + OFFSET_X, y: 184 + OFFSET_Y };

// 📦 재고 변경 시 앱에 브로드캐스트하는 공통 함수
function broadcastStockUpdate() {
  db.query('SELECT * FROM products', (err, results) => {
    if (!err) {
      io.emit('stock_updated', { products: results });
      console.log('📦 재고 변경 → 앱 브로드캐스트 완료');
    }
  });
}

// 💬 앱 유저별 소켓 매핑 (채팅 실시간 전송용)
const userSockets = {}; // { userId: socket }

/* 📡 --- STOMP (Spring Boot 채팅 연동) --- */
let stompClient = null;

function connectStomp() {
  stompClient = new Client({
    brokerURL: 'ws://localhost:8080/ws/websocket',
    reconnectDelay: 5000,
    onConnect: () => {
      console.log('🟩 [STOMP] Spring Boot 채팅 서버 연결 성공!');

      // 관리자가 앱 유저에게 보낸 메시지 수신
      stompClient.subscribe('/user/admin/queue/chat', (frame) => {
        try {
          const msg = JSON.parse(frame.body);
          console.log(`📨 관리자 → ${msg.userUsername}: ${msg.content}`);

          // 해당 유저 앱에 실시간 전송
          const targetSocket = userSockets[msg.userUsername];
          if (targetSocket) {
            targetSocket.emit('chat_message', {
              content: msg.content,
              fromAdmin: true,
              time: msg.time || new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
            });
          }

          // DB에도 저장
          db.query(
            'INSERT INTO chat_message (user_username, content, from_admin, is_read, created_at) VALUES (?, ?, 1, 0, NOW())',
            [msg.userUsername, msg.content]
          );
        } catch (e) {
          console.error('STOMP 메시지 파싱 오류:', e);
        }
      });
    },
    onDisconnect: () => {
      console.warn('⚠️ [STOMP] Spring Boot 채팅 서버 연결 끊김');
    },
    onStompError: (frame) => {
      console.error('❌ [STOMP] 오류:', frame.headers['message']);
    }
  });

  stompClient.activate();
}

connectStomp();

// 🚙 실제 로봇 주행 명령 함수
function driveRobotTo(targetPos, productId, isReturn = false) {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  robotPosition.status = isReturn ? 'RETURNING' : 'MOVING';
  robotPosition.currentProductId = productId;
  robotPosition.path = [];

  const realPixelX = targetPos.x - OFFSET_X;
  const realPixelY = targetPos.y - OFFSET_Y;
  const rosTargetX = ((MAP_HEIGHT_PIXELS - realPixelY) * RESOLUTION) + ORIGIN_X;
  const rosTargetY = (realPixelX * RESOLUTION) + ORIGIN_Y;

  console.log(`🎯 [목적지 전송] 터치(${Math.round(targetPos.x)}, ${Math.round(targetPos.y)}) -> ROS(${rosTargetX.toFixed(2)}m, ${rosTargetY.toFixed(2)}m)`);

  const goalMsg = {
    op: 'publish',
    topic: '/move_base_simple/goal',
    type: 'geometry_msgs/PoseStamped',
    msg: {
      header: { seq: 0, stamp: { secs: 0, nsecs: 0 }, frame_id: 'map' },
      pose: {
        position: { x: rosTargetX, y: rosTargetY, z: 0.0 },
        orientation: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 }
      }
    }
  };

  if (rosWs.readyState === WebSocket.OPEN) {
    rosWs.send(JSON.stringify(goalMsg));
    console.log(`📡 ROS 목적지 전송 완료 → x: ${rosTargetX.toFixed(2)}m, y: ${rosTargetY.toFixed(2)}m`);
  } else {
    console.error('❌ ROSbridge 연결 끊김 — 목적지 전송 실패');
  }

  io.emit('robot_position', robotPosition);

  intervalId = setInterval(() => {
    if (robotPosition.status !== 'MOVING' && robotPosition.status !== 'RETURNING') {
      clearInterval(intervalId);
      intervalId = null;
      return;
    }

    const dx = targetPos.x - robotPosition.x;
    const dy = targetPos.y - robotPosition.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 25) {
      clearInterval(intervalId);
      intervalId = null;

      if (isReturn) {
        robotPosition.status = 'IDLE';
        console.log('🏠 로봇이 무사히 홈 기지에 복귀했습니다.');
        checkAndProcessQueue();
      } else {
        robotPosition.status = 'ARRIVED'; 
        console.log('📍 로봇이 목적지에 도착했습니다.');
      }
      io.emit('robot_position', robotPosition);
    }
  }, 500);
}

// 📦 대기열 확인 및 다음 주문 처리
function checkAndProcessQueue() {
  if (orderQueue.length > 0) {
    const nextOrder = orderQueue.shift(); 
    io.emit('queue_updated', orderQueue); 
    console.log(`🚀 대기열에서 주문을 꺼내 출발합니다! (남은 대기: ${orderQueue.length}개)`);
    driveRobotTo(nextOrder.targetPos, nextOrder.productId, false);
  }
}

/* 📡 --- ROSbridge 웹소켓 연동 (자동 재연결 포함) --- */

function connectRosBridge() {
  const ws = new WebSocket('ws://192.168.0.51:9090');

  ws.on('open', () => {
    console.log('🟩 [ROSbridge] 로봇 라즈베리파이와 연결되었습니다!');
    ws.send(JSON.stringify({ op: 'subscribe', topic: '/odom', type: 'nav_msgs/Odometry' }));
    ws.send(JSON.stringify({ op: 'advertise', topic: '/move_base_simple/goal', type: 'geometry_msgs/PoseStamped' }));
  });

  ws.on('message', (data) => {
    try {
      const rawData = JSON.parse(data);
      if (rawData.op === 'publish' && rawData.topic === '/odom') {
        const msg = rawData.msg;
        const rosX = msg.pose.pose.position.x;
        const rosY = msg.pose.pose.position.y;
        const q = msg.pose.pose.orientation;
        const heading = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
        const mapPixelX = (rosY - ORIGIN_Y) / RESOLUTION;
        const mapPixelY = MAP_HEIGHT_PIXELS - ((rosX - ORIGIN_X) / RESOLUTION);
        robotPosition.x = mapPixelX + OFFSET_X;
        robotPosition.y = mapPixelY + OFFSET_Y;
        robotPosition.heading = heading - (Math.PI / 2);
        io.emit('robot_position', robotPosition);
      }
    } catch (err) {
      console.error('⚠️ [ROS 데이터 파싱 오류]:', err);
    }
  });

  ws.on('close', () => {
    console.warn('⚠️ ROSbridge 연결 끊김. 5초 후 재연결 시도...');
    setTimeout(() => { rosWs = connectRosBridge(); }, 5000);
  });

  ws.on('error', (err) => {
    console.error('❌ ROSbridge 오류:', err.message);
  });

  return ws;
}

let rosWs = connectRosBridge();

/* --- API 라우터 --- */

app.post('/api/signup', (req, res) => {
  const { userId, password, name } = req.body;
  db.query('INSERT INTO users (userId, password, name) VALUES (?, ?, ?)', [userId, password, name], (err) => {
    if (err) return res.status(500).json({ success: false, message: '이미 존재하는 아이디입니다.' });
    return res.json({ success: true });
  });
});

app.post('/api/login', (req, res) => {
  const { userId, password } = req.body;
  db.query('SELECT id, userId, name, role FROM users WHERE userId = ? AND password = ?', [userId, password], (err, results) => {
    if (err) return res.status(500).json({ success: false, message: '서버 오류' });
    if (results.length > 0) return res.json({ success: true, user: results[0] });
    return res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 틀렸습니다.' });
  });
});

app.get('/api/products', (req, res) => {
  db.query('SELECT * FROM products', (err, results) => {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true, products: results });
  });
});

app.post('/api/products/restock', (req, res) => {
  db.query('UPDATE products SET stock = stock + 1 WHERE id = ?', [req.body.productId], (err) => {
    if (err) return res.status(500).json({ success: false });
    broadcastStockUpdate();
    res.json({ success: true });
  });
});

app.post('/api/products/add', (req, res) => {
  const { name, price, stock, icon } = req.body;
  db.query('INSERT INTO products (name, price, stock, icon) VALUES (?, ?, ?, ?)', [name, price, stock, icon], (err) => {
    if (err) return res.status(500).json({ success: false });
    broadcastStockUpdate();
    res.json({ success: true });
  });
});

app.post('/api/products/delete', (req, res) => {
  const { productId } = req.body;
  db.query('DELETE FROM products WHERE id = ?', [productId], (err) => {
    if (err) return res.status(500).json({ success: false });
    broadcastStockUpdate();
    res.json({ success: true });
  });
});

app.post('/api/products/purchase-complete', (req, res) => {
  const { productId, quantity, userName } = req.body;
  
  const targetProductId = productId || robotPosition.currentProductId;
  const targetQuantity = parseInt(quantity, 10) || 1;
  const buyerName = userName || '앱사용자';

  if (!targetProductId) return res.status(400).json({ success: false, message: '상품 정보가 유실되었습니다.' });
  
  db.query('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', [targetQuantity, targetProductId, targetQuantity], (err, results) => {
    if (err || results.affectedRows === 0) return res.status(400).json({ success: false, message: '재고가 부족하여 처리가 불가능합니다.' });
    
    db.query('SELECT name, price FROM products WHERE id = ?', [targetProductId], (priceErr, priceResults) => {
      if (priceErr || priceResults.length === 0) return res.status(500).json({ success: false });
      
      const productName = priceResults[0].name;
      const productPrice = priceResults[0].price;

      const bulkOrderData = [];
      for (let i = 0; i < targetQuantity; i++) {
        bulkOrderData.push([targetProductId, productPrice]);
      }

      db.query('INSERT INTO orders (product_id, price) VALUES ?', [bulkOrderData], (orderErr) => {
        if (orderErr) {
          console.error('❌ 주문 내역 인서트 중 오류 발생:', orderErr);
          return res.status(500).json({ success: false });
        }

        // purchase_history에도 기록
        const historyData = [];
        for (let i = 0; i < targetQuantity; i++) {
          historyData.push([productName, productPrice, buyerName]);
        }
        db.query(
          'INSERT INTO purchase_history (product_name, paid_price, buyer_name) VALUES ?',
          [historyData],
          (histErr) => {
            if (histErr) console.error('⚠️ purchase_history 기록 실패:', histErr);
          }
        );

        robotPosition.currentProductId = null;
        broadcastStockUpdate();

        if (orderQueue.length > 0) {
          checkAndProcessQueue();
        } else {
          console.log('💤 대기 주문이 없습니다. 홈 기지로 복귀합니다.');
          driveRobotTo(HOME_POS, null, true);
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
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  orderQueue = [];
  io.emit('queue_updated', orderQueue);
  robotPosition.x = HOME_POS.x;
  robotPosition.y = HOME_POS.y;
  robotPosition.heading = 0;
  robotPosition.status = 'IDLE';
  robotPosition.battery = 100;
  robotPosition.currentProductId = null;
  robotPosition.path = [];
  robotPosition.obstacles = [];
  io.emit('robot_position', robotPosition);
  console.log('🚨 [ADMIN COMMAND] 로봇 긴급 정지 및 주문 대기열 초기화 완료!');
  return res.json({ success: true });
});

// 웹(Spring Boot)에서 재고 변경 시 호출
app.post('/api/stock-updated', (req, res) => {
  broadcastStockUpdate();
  res.json({ success: true });
});

/* --- 웹소켓(Socket.io) --- */

io.on('connection', (socket) => {
  socket.emit('robot_position', robotPosition);
  socket.emit('queue_updated', orderQueue);

  db.query('SELECT * FROM products', (err, results) => {
    if (!err) socket.emit('stock_updated', { products: results });
  });

  socket.on('call_robot', (data) => {
    const { targetPos, productId } = data;
    const newOrder = { targetPos, productId };
    if (['IDLE', 'RETURNING', 'ARRIVED'].includes(robotPosition.status)) {
      console.log(`🛒 로봇이 즉시 주문을 처리하러 출발합니다. (현재 상태: ${robotPosition.status})`);
      driveRobotTo(targetPos, productId, false);
    } else {
      orderQueue.push(newOrder);
      io.emit('queue_updated', orderQueue);
      console.log(`📋 로봇이 바쁩니다. 주문을 대기열에 추가합니다. (총 대기: ${orderQueue.length}개)`);
    }
  });

  /* 💬 채팅 이벤트 */

  // 앱 유저 채팅방 입장
  socket.on('chat_join', ({ userId }) => {
  userSockets[userId] = socket;
  db.query(
    'SELECT * FROM chat_message WHERE user_username = ? ORDER BY created_at ASC',
    [userId],
    (err, results) => {
      if (!err) {
        const messages = results.map(msg => ({
          ...msg,
          fromAdmin: Buffer.isBuffer(msg.from_admin)
            ? msg.from_admin[0] === 1
            : Boolean(msg.from_admin)
        }));
        socket.emit('chat_history', { messages });
      }
    }
  );
});

  // 앱 유저가 메시지 전송
  socket.on('chat_send', ({ userId, content }) => {
  if (!userId || !content) return;

  db.query(
    'INSERT INTO chat_message (user_username, content, from_admin, is_read, created_at) VALUES (?, ?, 0, 0, NOW())',
    [userId, content],
    (err) => {
      if (err) { console.error('채팅 저장 실패:', err); return; }

      const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

      // ✅ 추가 — 보낸 사람 앱에 echo (오른쪽에 표시)
      socket.emit('chat_message', {
        content,
        fromAdmin: false,
        time
      });

      // Spring Boot STOMP로 전달
      if (stompClient && stompClient.connected) {
        stompClient.publish({
          destination: '/app/chat/user/send',
          body: JSON.stringify({ content }),
          headers: { login: userId }
        });
      }
    }
  );
});

  // 앱 유저 채팅방 퇴장
  socket.on('chat_leave', ({ userId }) => {
    delete userSockets[userId];
    console.log(`💬 [채팅] ${userId} 퇴장`);
  });

  socket.on('disconnect', () => {
    // 소켓 끊기면 userSockets에서 제거
    for (const [userId, s] of Object.entries(userSockets)) {
      if (s === socket) {
        delete userSockets[userId];
        console.log(`💬 [채팅] ${userId} 소켓 끊김`);
        break;
      }
    }
  });
});

server.listen(4000, () => console.log('🚀 풀스택 대기열 & ROS 하이브리드 서버 가동 중 (포트 4000)'));