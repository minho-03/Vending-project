// frontend/screens/MainScreen.js
import React, { useState, useEffect, useRef } from 'react';
import { View, TouchableOpacity, Text, SafeAreaView, Alert, Modal, Vibration, ScrollView } from 'react-native';
import { WebView } from 'react-native-webview'; 
import { io } from 'socket.io-client';
import QRCode from 'react-native-qrcode-svg';
import styles from '../styles/MainStyles';

const SERVER_URL = 'http://192.168.0.10:4000';

export default function MainScreen({ user, setUser }) {
  const [status, setStatus] = useState('IDLE');
  const [battery, setBattery] = useState(100);
  const [qrValue, setQrValue] = useState(null);
  const [isModalVisible, setModalVisible] = useState(false);

  const [products, setProducts] = useState([]);
  const [isStockModalVisible, setStockModalVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [robotData, setRobotData] = useState({ x: 50, y: 50, heading: 0, path: [], obstacles: [] });
  const [targetPos, setTargetPos] = useState({ x: 50, y: 50 });

  const socketRef = useRef(null);
  const webViewRef = useRef(null); 

  // --- 🌐 [수정] 밝은 톤(화이트 테마)에 맞춘 관제 맵 HTML/CSS 설정 ---
  const mapHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <style>
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; background: #ffffff; overflow: hidden; touch-action: none; }
        canvas { display: block; width: 100vw; height: 100vh; cursor: grab; }
        canvas:active { cursor: grabbing; }
      </style>
    </head>
    <body>
      <canvas id="mapCanvas"></canvas>
      <script>
        const canvas = document.getElementById('mapCanvas');
        const ctx = canvas.getContext('2d');

        let currentRobot = { x: 50, y: 50, heading: 0 };
        let targetRobot = { x: 50, y: 50, heading: 0 };
        let state = { targetX: 50, targetY: 50, path: [], obstacles: [] };
        
        let camera = { x: 30, y: 50, scale: 1.2 };
        let isDragging = false;
        let dragStart = { x: 0, y: 0 };
        let touchStartX = 0; let touchStartY = 0; let isMoved = false;
        let initialPinchDistance = null; let initialScale = 1;

        function resize() {
          canvas.width = window.innerWidth || 300;
          canvas.height = window.innerHeight || 300;
        }
        window.addEventListener('resize', resize);
        resize();

        function handleMessage(event) {
          try {
            const newData = JSON.parse(event.data);
            targetRobot.x = newData.x ?? targetRobot.x;
            targetRobot.y = newData.y ?? targetRobot.y;
            targetRobot.heading = newData.heading ?? targetRobot.heading;
            
            state.targetX = newData.targetX ?? state.targetX;
            state.targetY = newData.targetY ?? state.targetY;
            state.path = newData.path || [];
            state.obstacles = newData.obstacles || [];
          } catch (e) { console.error(e); }
        }
        window.addEventListener('message', handleMessage);
        document.addEventListener('message', handleMessage);

        canvas.addEventListener('mousedown', (e) => {
          isMoved = false; isDragging = true;
          touchStartX = e.clientX; touchStartY = e.clientY;
          dragStart.x = touchStartX - camera.x; dragStart.y = touchStartY - camera.y;
        });
        canvas.addEventListener('mousemove', (e) => {
          if (!isDragging) return;
          if (Math.hypot(e.clientX - touchStartX, e.clientY - touchStartY) > 5) {
            isMoved = true;
            camera.x = e.clientX - dragStart.x; camera.y = e.clientY - dragStart.y;
          }
        });
        canvas.addEventListener('mouseup', (e) => {
          isDragging = false;
          if (!isMoved) handleMapClick(e.clientX, e.clientY);
        });

        canvas.addEventListener('wheel', (e) => {
          e.preventDefault();
          const zoomAmount = 1 - (e.deltaY * 0.0015);
          camera.scale = Math.min(Math.max(camera.scale * zoomAmount, 0.4), 4);
        }, { passive: false });

        canvas.addEventListener('touchstart', (e) => {
          if (e.touches.length === 1) {
            isMoved = false;
            touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY;
            dragStart.x = touchStartX - camera.x; dragStart.y = touchStartY - camera.y;
          } else if (e.touches.length === 2) {
            isMoved = true;
            initialPinchDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            initialScale = camera.scale;
          }
        });
        canvas.addEventListener('touchmove', (e) => {
          e.preventDefault();
          if (e.touches.length === 1) {
            if (Math.hypot(e.touches[0].clientX - touchStartX, e.touches[0].clientY - touchStartY) > 5) isMoved = true;
            if (isMoved) { camera.x = e.touches[0].clientX - dragStart.x; camera.y = e.touches[0].clientY - dragStart.y; }
          } else if (e.touches.length === 2) {
            const currentDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            camera.scale = Math.min(Math.max(initialScale * (currentDist / initialPinchDistance), 0.4), 4);
          }
        }, { passive: false });
        canvas.addEventListener('touchend', (e) => {
          if (!isMoved && e.changedTouches.length === 1) handleMapClick(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
        });

        function handleMapClick(screenX, screenY) {
          const worldX = (screenX - camera.x) / camera.scale;
          const worldY = (screenY - camera.y) / camera.scale;
          state.targetX = worldX; state.targetY = worldY;
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_CLICK', x: worldX, y: worldY }));
        }

        function updateAndDraw() {
          currentRobot.x += (targetRobot.x - currentRobot.x) * 0.15;
          currentRobot.y += (targetRobot.y - currentRobot.y) * 0.15;
          
          let diff = targetRobot.heading - currentRobot.heading;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          currentRobot.heading += diff * 0.15;

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.save();
          ctx.translate(camera.x, camera.y);
          ctx.scale(camera.scale, camera.scale);

          // 🎨 [변경] 흰색 배경에 잘 보이는 연한 연갈색 격자선과 어두운 갈색 글씨로 매핑
          const gridSize = 50;
          ctx.strokeStyle = '#ede8e0'; ctx.lineWidth = 1 / camera.scale;
          ctx.fillStyle = '#9e8c7a'; ctx.font = \`\${10 / camera.scale}px sans-serif\`;

          for (let x = -1000; x < 2000; x += gridSize) {
            ctx.beginPath(); ctx.moveTo(x, -1000); ctx.lineTo(x, 2000); ctx.stroke();
            if (x % 100 === 0 && x !== 0) ctx.fillText(x, x + 2, 12); 
          }
          for (let y = -1000; y < 2000; y += gridSize) {
            ctx.beginPath(); ctx.moveTo(-1000, y); ctx.lineTo(2000, y); ctx.stroke();
            if (y % 100 === 0 && y !== 0) ctx.fillText(y, 2, y - 2); 
          }

          // 📍 원점 십자 마커 (연한 감성 브라운)
          ctx.strokeStyle = '#c47d4a'; ctx.lineWidth = 2 / camera.scale;
          ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(15, 0); ctx.moveTo(0, -15); ctx.lineTo(0, 15); ctx.stroke();

          // 🛣️ 글로벌 경로선 (차분한 그린 라인)
          if (state.path && state.path.length > 0) {
            ctx.strokeStyle = '#10b981'; ctx.lineWidth = 2.5 / camera.scale;
            ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(currentRobot.x, currentRobot.y);
            state.path.forEach(pt => ctx.lineTo(pt.x, pt.y));
            ctx.lineTo(state.targetX, state.targetY); ctx.stroke(); ctx.setLineDash([]);
          }

          // ⚠️ 라이다 센서 장애물 포인트
          if (state.obstacles && state.obstacles.length > 0) {
            state.obstacles.forEach(obs => {
              ctx.fillStyle = '#ef4444'; ctx.shadowColor = 'rgba(239, 68, 68, 0.3)'; ctx.shadowBlur = 4;
              ctx.beginPath(); ctx.arc(obs.x, obs.y, 4, 0, Math.PI * 2); ctx.fill();
            });
            ctx.shadowBlur = 0;
          }

          // 🚩 목적지 핀 웨이포인트 (오렌지 마커)
          ctx.fillStyle = '#f97316'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1 / camera.scale;
          ctx.beginPath(); ctx.arc(state.targetX, state.targetY, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = 'rgba(249, 115, 22, 0.3)';
          ctx.beginPath(); ctx.arc(state.targetX, state.targetY, 12, 0, Math.PI * 2); ctx.stroke();

          // 🤖 [변경] 자율주행 AGV 로봇 에이전트를 앱 메인 컬러(브라운 테마 #c47d4a)로 통일!
          ctx.save();
          ctx.translate(currentRobot.x, currentRobot.y);
          ctx.rotate(currentRobot.heading);

          ctx.fillStyle = '#c47d4a'; ctx.strokeStyle = '#3d2c1e'; ctx.lineWidth = 2 / camera.scale;
          ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

          // 로봇 방향 지시 노즈 (진한 갈색)
          ctx.fillStyle = '#3d2c1e';
          ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(3, -6); ctx.lineTo(3, 6); ctx.fill();

          // 실시간 라이다 센서 반경 가이드라인
          ctx.strokeStyle = 'rgba(196, 125, 74, 0.15)'; ctx.lineWidth = 1 / camera.scale;
          ctx.beginPath(); ctx.arc(0, 0, 50, 0, Math.PI * 2); ctx.setLineDash([2, 4]); ctx.stroke();

          ctx.restore();
          ctx.restore();

          requestAnimationFrame(updateAndDraw);
        }
        
        requestAnimationFrame(updateAndDraw);
      </script>
    </body>
    </html>
  `;

  useEffect(() => {
    socketRef.current = io(SERVER_URL);
    socketRef.current.on('robot_position', (data) => {
      setRobotData(data);
      if (data.battery !== undefined) setBattery(data.battery);

      if (webViewRef.current) {
        webViewRef.current.postMessage(JSON.stringify({
          x: data.x, y: data.y, heading: data.heading, 
          targetX: targetPos.x, targetY: targetPos.y,
          path: data.path, obstacles: data.obstacles
        }));
      }

      setStatus((prevStatus) => {
        if (prevStatus !== 'ARRIVED' && data.status === 'ARRIVED') {
          Vibration.vibrate(1000);
          Alert.alert("🤖 로봇 도착 완료!", `로봇이 지정하신 목적지에 도착했습니다.\n배터리: ${data.battery}%`);
        }
        return data.status;
      });
    });

    return () => { if (socketRef.current) socketRef.current.disconnect(); };
  }, [targetPos]);

  const handleWebViewMessage = (event) => {
    const data = JSON.parse(event.nativeEvent.data);
    if (data.type === 'MAP_CLICK') {
      setTargetPos({ x: data.x, y: data.y });
    }
  };

  const handleCallRobot = () => {
    if (!selectedProduct) { Alert.alert("알림", "🛒 [자판기 메뉴판]을 눌러 먼저 음료수를 골라주세요!"); return; }
    if (!qrValue) { Alert.alert("알림", "💳 먼저 음료수 비용을 [결제 및 발급] 해주세요."); return; }
    if (socketRef.current) socketRef.current.emit('call_robot', { targetPos: targetPos, productId: selectedProduct.id });
  };

  const handleQRButtonPress = () => {
    if (!selectedProduct) { Alert.alert("알림", "구매할 음료를 먼저 선택해 주세요."); return; }
    if (qrValue) { setModalVisible(true); } else {
      Alert.alert("💳 결제 진행", `[${selectedProduct.name}]을(를) 결제하시겠습니까?`, [
        { text: "취소", style: "cancel" },
        { text: "결제하기", onPress: () => { setQrValue("PIMTO-" + Math.floor(Math.random() * 100000)); setModalVisible(true); } }
      ]);
    }
  };

  const handleItemReceived = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/api/products/purchase-complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await response.json();
      if (data.success) {
        Alert.alert("수령 완료 🎉", "음료 배송이 완료되었습니다!");
        setQrValue(null); setSelectedProduct(null); setModalVisible(false);
      }
    } catch (error) { Alert.alert("오류", "통신에 실패했습니다."); }
  };

  const fetchProducts = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/api/products`);
      const data = await response.json();
      if (data.success) { setProducts(data.products); setStockModalVisible(true); }
    } catch (error) { Alert.alert("네트워크 오류", "연결 실패"); }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* 상단 관제 대시보드 상태창 */}
        <View style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.logoText}>PIMTO SYSTEM</Text>
              <Text style={styles.subtitleText}>자율주행 모빌리티 배송 플랫폼</Text>
            </View>
            <TouchableOpacity style={styles.logoutButton} onPress={() => setUser(null)}><Text style={styles.logoutButtonText}>로그아웃</Text></TouchableOpacity>
          </View>
          
          <View style={{ marginTop: 8, padding: 8, backgroundColor: '#f5f6f8', borderRadius: 6 }}>
            <Text style={{ color: '#4c4f69', fontWeight: 'bold', fontSize: 13 }}>
              🥤 투입된 음료 선택 상태: {selectedProduct ? `${selectedProduct.icon} ${selectedProduct.name} (선택됨)` : '❌ 상품을 선택해 주세요'}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', marginTop: 10, gap: 8 }}>
            <View style={styles.statusBadge}>
              <View style={[styles.statusDot, status === 'MOVING' ? { backgroundColor: '#00ff9d' } : { backgroundColor: '#ff9e64' }]} />
              <Text style={styles.statusText}>상태: {status === 'MOVING' ? '🚀 배송중' : status === 'ARRIVED' ? '✅ 도착함' : '💤 대기중'}</Text>
            </View>
            <View style={styles.statusBadge}><Text style={styles.statusText}>🔋 배터리: {battery}%</Text></View>
          </View>
        </View>

        {/* 📡 1. [수정] 지도 하드코딩 스타일 제거 -> MainStyles.js의 하얀 배경과 완벽 동기화 */}
        <Text style={styles.sectionTitle}>📡 ROS LiDAR 격자 맵</Text>
        <View style={styles.mapContainer}>
          <WebView
            ref={webViewRef}
            originWhitelist={['*']}
            source={{ html: mapHtml }}
            onMessage={handleWebViewMessage}
            style={{ flex: 1, backgroundColor: 'transparent' }} // 배경 투명 처리로 컨테이너 테두리 보존
            scrollEnabled={false}
            javaScriptEnabled={true}
          />
        </View>
        <Text style={styles.tipText}>💡 마우스 휠 또는 멀티터치로 줌인/아웃이 유연하게 연동됩니다.</Text>

        {/* 🛠️ 2. [수정] 하단 제어부 파란색 하드코딩 제거 -> 베이지 테마로 일괄 자동 통일 */}
        <View style={styles.controlPanel}>
          <View style={styles.coordInfoRow}>
            <Text style={styles.coordLabel}>하차 지정 좌표 (Target)</Text>
            <Text style={styles.coordValue}>X: {Math.round(targetPos.x)} · Y: {Math.round(targetPos.y)}</Text>
          </View>
          
          <TouchableOpacity style={styles.callButton} onPress={handleCallRobot}>
            <Text style={styles.callButtonText}>🤖 지정한 위치로 자판기 로봇 출발시키기</Text>
          </TouchableOpacity>
          
          <View style={styles.subButtonRow}>
            {/* ⭕ 파란색 오버라이드를 빼서 우측 QR 버튼과 완벽하게 똑같은 베이지색 톤으로 통일 완료! */}
            <TouchableOpacity style={styles.subButton} onPress={fetchProducts}>
              <Text style={styles.subButtonText}>🛒 자판기 메뉴판</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={[styles.subButton, qrValue ? styles.qrActiveButton : null]} onPress={handleQRButtonPress}>
              <Text style={[styles.subButtonText, qrValue ? styles.qrActiveText : null]}>
                {qrValue ? "📱 인증용 QR 보기" : "💳 결제 및 발급"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 모달 창 구성품들 */}
        <Modal visible={isModalVisible} transparent={true} animationType="fade">
          <View style={styles.modalBackground}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>✅ 자판기 결제 승인 완료!</Text>
              <Text style={{ marginBottom: 15, color: '#666', textAlign: 'center' }}>로봇이 도착하면 아래 QR을 카메라에 인식시켜 음료를 수령하세요.</Text>
              <View style={styles.qrWrapper}>{qrValue && <QRCode value={qrValue} size={180} />}</View>
              <TouchableOpacity style={styles.closeButton} onPress={() => setModalVisible(false)}><Text style={styles.closeButtonText}>로봇 호출하기</Text></TouchableOpacity>
              <TouchableOpacity style={styles.finishButton} onPress={handleItemReceived}><Text style={styles.finishButtonText}>🎁 수령 완료 후 QR 폐기</Text></TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Modal visible={isStockModalVisible} transparent={true} animationType="slide">
          <View style={styles.modalBackground}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>🥤 자판기 메뉴판</Text>
              <ScrollView style={{ width: '100%', maxHeight: 300, marginBottom: 20 }}>
                {products.map((item) => (
                  <TouchableOpacity key={item.id} style={[styles.productItem, selectedProduct?.id === item.id ? { borderColor: '#7aa2f7', borderWidth: 2 } : null]} onPress={() => { setSelectedProduct(item); setStockModalVisible(false); }}>
                    <Text style={styles.productIcon}>{item.icon}</Text>
                    <View style={styles.productInfo}>
                      <Text style={styles.productName}>{item.name}</Text>
                      <Text style={{ fontSize: 11, color: '#888' }}>상태: {item.stock > 0 ? '판매중' : '품절'}</Text>
                    </View>
                    <View style={[styles.stockBadge, item.stock === 0 ? { backgroundColor: '#ff5370' } : null]}>
                      <Text style={styles.stockText}>{item.stock > 0 ? `${item.stock}개 남음` : '품절'}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.closeButton} onPress={() => setStockModalVisible(false)}><Text style={styles.closeButtonText}>닫기</Text></TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}