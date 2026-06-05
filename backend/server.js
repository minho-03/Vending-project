// backend/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// 가짜 로봇의 현재 위치 (초기값)
let currentX = 120;
let currentY = 180;
let moveInterval = null;

io.on('connection', (socket) => {
  console.log('📱 앱 연결됨! 로봇 대기 중...');

  // 앱 연결 시 현재 위치 먼저 알려주기
  socket.emit('robot_position', { x: currentX, y: currentY, status: 'IDLE' });

  // 1. 앱에서 '호출' 명령과 목적지 좌표를 받았을 때
  socket.on('call_robot', (targetPos) => {
    console.log(`🚀 이동 명령 수신! 목적지 -> X: ${targetPos.x}, Y: ${targetPos.y}`);
    
    // 혹시 기존에 움직이던 게 있으면 멈춤
    if (moveInterval) clearInterval(moveInterval);

    // 2. 0.05초(50ms)마다 목적지를 향해 조금씩 이동하는 타이머 시작
    moveInterval = setInterval(() => {
      // 목적지와 현재 위치의 거리 차이 계산
      const dx = targetPos.x - currentX;
      const dy = targetPos.y - currentY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // 도착했다고 칠 만큼 가까워지면(1px 이내) 타이머 종료
      if (distance < 1) {
        currentX = targetPos.x;
        currentY = targetPos.y;
        clearInterval(moveInterval);
        socket.emit('robot_position', { x: currentX, y: currentY, status: 'ARRIVED' });
        console.log('✅ 로봇 도착 완료!');
        return;
      }

      // 아직 멀었다면 목적지 방향으로 조금씩(비율만큼) 이동
      currentX += dx * 0.05; // 0.05는 이동 속도(클수록 빠름)
      currentY += dy * 0.05;

      // 3. 이동 중인 현재 좌표를 앱으로 계속 쏴주기
      socket.emit('robot_position', { x: currentX, y: currentY, status: 'MOVING' });
    }, 50); // 50ms 마다 갱신 (부드러운 애니메이션 효과)
  });

  socket.on('disconnect', () => {
    console.log('❌ 앱 연결 끊김');
    if (moveInterval) clearInterval(moveInterval);
  });
});

server.listen(4000, () => {
  console.log('🚀 가짜 로봇(백엔드) 서버가 4000번 포트에서 가동 중입니다.');
});