// backend/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mysql = require('mysql2'); // ★ MariaDB/MySQL 연동 라이브러리 추가

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
  password: '',      // 👈 방금 비밀번호 초기화로 비워둔 값과 일치합니다!
  database: 'vending_db' // 아까 터미널에서 CREATE DATABASE로 만든 이름
});

db.connect((err) => {
  if (err) {
    console.error('❌ MariaDB 연결 실패... 테이블 생성을 먼저 하셨는지 확인해보세요!', err);
    return;
  }
  console.log('🟩 MariaDB 데이터베이스 연결 성공!');
});

let robotPosition = { x: 120, y: 180, status: 'IDLE' };
let intervalId = null;

// ==========================================
// 🔐 [HTTP REST API] 진짜 DB 연동 회원가입 & 로그인
// ==========================================

// 1. 회원가입 API (DB에 새 유저 삽입)
app.post('/api/signup', (req, res) => {
  const { userId, password, name } = req.body;
  
  if (!userId || !password || !name) {
    return res.status(400).json({ success: false, message: '모든 항목을 입력해주세요.' });
  }

  // 중복 아이디 검사 (SQL 쿼리문)
  const checkSql = 'SELECT * FROM users WHERE userId = ?';
  db.query(checkSql, [userId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'DB 오류 발생' });
    }
    
    if (results.length > 0) {
      return res.status(400).json({ success: false, message: '이미 존재하는 아이디입니다.' });
    }

    // 중복이 없으면 진짜 DB 테이블에 저장 (INSERT)
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

// 2. 로그인 API (DB에서 유저 조회)
app.post('/api/login', (req, res) => {
  const { userId, password } = req.body;

  // 입력한 아이디와 비밀번호가 일치하는 유저 찾기 (SELECT)
  const loginSql = 'SELECT userId, name FROM users WHERE userId = ? AND password = ?';
  db.query(loginSql, [userId, password], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'DB 오류 발생' });
    }

    if (results.length > 0) {
      const user = results[0];
      console.log(`[MariaDB 로그인 성공] ${user.name}(${user.userId})님이 접속했습니다.`);
      return res.json({ success: true, user: { userId: user.userId, name: user.name } });
    } else {
      return res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 틀렸습니다.' });
    }
  });
});

// ==========================================
// 🤖 [Socket.io] 로봇 제어 로직 (기존 유지)
// ==========================================
io.on('connection', (socket) => {
  console.log('클라이언트 연결됨:', socket.id);
  socket.emit('robot_position', robotPosition);

  socket.on('call_robot', (targetPos) => {
    if (intervalId) clearInterval(intervalId);
    robotPosition.status = 'MOVING';
    io.emit('robot_position', robotPosition);

    intervalId = setInterval(() => {
      let dx = targetPos.x - robotPosition.x;
      let dy = targetPos.y - robotPosition.y;
      let distance = Math.sqrt(dx * dx + dy * dy);

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