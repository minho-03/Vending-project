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
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ==========================================
// 🗄️ [MariaDB / MySQL 연결 설정]
// ==========================================
const db = mysql.createConnection({
  host: '127.0.0.1',
  port: 3307,
  user: 'root',      
  password: '',      
  database: 'vending_db' 
});

db.connect((err) => {
  if (err) {
    console.error('❌ MariaDB 연결 실패... 테이블 생성을 먼저 하셨는지 확인해보세요!', err);
    return;
  }
  console.log('🟩 MariaDB 데이터베이스 연결 성공!');
});

// 🔋 [수정] 로봇이 현재 처리 중인 상품 ID(currentProductId) 상태 추가
let robotPosition = { x: 120, y: 180, status: 'IDLE', battery: 100, currentProductId: null };
let intervalId = null;

// ==========================================
// 🔐 [HTTP REST API] 진짜 DB 연동 회원가입 & 로그인
// ==========================================

// 1. 회원가입 API
app.post('/api/signup', (req, res) => {
  const { userId, password, name } = req.body;
  
  if (!userId || !password || !name) {
    return res.status(400).json({ success: false, message: '모든 항목을 입력해주세요.' });
  }

  const checkSql = 'SELECT * FROM users WHERE userId = ?';
  db.query(checkSql, [userId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'DB 오류 발생' });
    }
    
    if (results.length > 0) {
      return res.status(400).json({ success: false, message: '이미 존재하는 아이디입니다.' });
    }

    const insertSql = 'INSERT INTO users (userId, password, name) VALUES (?, ?, ?)';
    db.query(insertSql, [userId, password, name], (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: '회원가입 실패' });
      }
      
      console.log(`[MariaDB 회원가입 완료] ID: ${userId}, 이름: ${name}`);
      return res.json({ success: true, message: '회원가입이 완료되었습니다!' });
    });
  });
});

// 2. 로그인 API
app.post('/api/login', (req, res) => {
  const { userId, password } = req.body;
  const loginSql = 'SELECT id, userId, name, role FROM users WHERE userId = ? AND password = ?';
  
  db.query(loginSql, [userId, password], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'DB 오류 발생' });
    }

    if (results.length > 0) {
      const user = results[0];
      console.log(`[MariaDB 로그인 성공] ${user.name}(${user.userId})님이 접속했습니다. 권한: ${user.role}`);
      
      return res.json({ 
        success: true, 
        user: { 
          id: user.id,
          userId: user.userId, 
          name: user.name, 
          role: user.role 
        } 
      });
    } else {
      return res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 틀렸습니다.' });
    }
  });
});

// 3. 상품 목록 및 재고 조회 API
app.get('/api/products', (req, res) => {
  const sql = 'SELECT * FROM products';
  db.query(sql, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'DB 오류 발생' });
    }
    return res.json({ success: true, products: results });
  });
});

// 4. [관리자 전용] 상품 재고 1개 추가 API
app.post('/api/products/restock', (req, res) => {
  const { productId } = req.body;
  const sql = 'UPDATE products SET stock = stock + 1 WHERE id = ?';
  
  db.query(sql, [productId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'DB 오류 발생' });
    }
    return res.json({ success: true, message: '재고가 1개 추가되었습니다.' });
  });
});

// 5. [관리자 전용] 새 상품(메뉴) 등록 API
app.post('/api/products/add', (req, res) => {
  const { name, price, stock, icon } = req.body;

  if (!name || !price || stock === undefined || !icon) {
    return res.status(400).json({ success: false, message: '모든 항목을 입력해주세요.' });
  }

  const sql = 'INSERT INTO products (name, price, stock, icon) VALUES (?, ?, ?, ?)';
  db.query(sql, [name, price, parseInt(stock), icon], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'DB 오류 발생' });
    }
    return res.json({ success: true, message: '새 메뉴가 성공적으로 등록되었습니다!' });
  });
});

// 6. ✨ [신규 추가] 사용자 물건 최종 수령 시 실제 DB 재고 차감 API
app.post('/api/products/purchase-complete', (req, res) => {
  const productId = robotPosition.currentProductId;

  if (!productId) {
    return res.status(400).json({ success: false, message: '현재 처리 중인 음료 주문이 없습니다.' });
  }

  // 재고가 0보다 클 때만 1 감소 시키는 쿼리
  const sql = 'UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0';
  
  db.query(sql, [productId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: '재고 반영 중 DB 오류가 발생했습니다.' });
    }

    if (results.affectedRows === 0) {
      return res.status(400).json({ success: false, message: '상품 재고가 부족하거나 존재하지 않습니다.' });
    }

    console.log(`[재고 차감 완료] 상품 ID: ${productId}의 재고가 1개 감소했습니다.`);
    
    // 비즈니스 로직 종료 후 로봇의 현재 실은 상품 초기화
    robotPosition.currentProductId = null;
    
    return res.json({ success: true, message: '재고 차감 및 수령 처리가 완료되었습니다.' });
  });
});
// 7. [관리자 전용] 상품 완전히 삭제 API (추가)
app.post('/api/products/delete', (req, res) => {
  const { productId } = req.body;

  if (!productId) {
    return res.status(400).json({ success: false, message: '삭제할 상품 ID가 없습니다.' });
  }

  // DB에서 해당 ID의 상품을 완전히 지우는 쿼리
  const sql = 'DELETE FROM products WHERE id = ?';
  
  db.query(sql, [productId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'DB 오류로 상품을 삭제하지 못했습니다.' });
    }
    
    return res.json({ success: true, message: '상품이 메뉴판에서 완전히 삭제되었습니다.' });
  });
});

// ==========================================
// 🤖 [Socket.io] 로봇 제어 로직 (배터리 소모 및 주문 연동)
// ==========================================
io.on('connection', (socket) => {
  console.log('클라이언트 연결됨:', socket.id);
  socket.emit('robot_position', robotPosition);

  // 💡 데이터 구조를 객체 { targetPos, productId } 형태로 확장 수신
  socket.on('call_robot', (data) => {
    const { targetPos, productId } = data;

    if (intervalId) clearInterval(intervalId);
    
    robotPosition.status = 'MOVING';
    robotPosition.currentProductId = productId; // 로봇에 매핑
    io.emit('robot_position', robotPosition);

    intervalId = setInterval(() => {
      let dx = targetPos.x - robotPosition.x;
      let dy = targetPos.y - robotPosition.y;
      let distance = Math.sqrt(dx * dx + dy * dy);

      if (robotPosition.battery > 0) {
        robotPosition.battery = Math.max(0, Number((robotPosition.battery - 0.1).toFixed(1)));
      }

      if (distance < 5) {
        clearInterval(intervalId);
        robotPosition.x = targetPos.x;
        robotPosition.y = targetPos.y;
        robotPosition.status = 'ARRIVED'; 
        io.emit('robot_position', robotPosition);
      } else {
        robotPosition.x += (dx / distance) * 4;
        robotPosition.y += (dy / distance) * 4;
        io.emit('robot_position', robotPosition);
      }
    }, 100);
  });

  socket.on('disconnect', () => {
    console.log('클라이언트 연결 해제됨:', socket.id);
  });
});

server.listen(4000, () => {
  console.log('🚀 백엔드 서버가 4000번 포트에서 가동 중입니다!');
});