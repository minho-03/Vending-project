// frontend/screens/MainScreen.js
import React, { useState, useEffect, useRef } from 'react';
import { View, TouchableOpacity, Text, SafeAreaView, Alert, Modal, Vibration, ScrollView } from 'react-native';
import { WebView } from 'react-native-webview'; 
import { io } from 'socket.io-client';
import QRCode from 'react-native-qrcode-svg';
import styles from '../styles/MainStyles';

const SERVER_URL = 'http://192.168.0.62:4000';
const ROSBRIDGE_URL = 'ws://192.168.0.51:9090';

export default function MainScreen({ user, setUser, onChat }) { // ✅ onInquiry → onChat
  const [status, setStatus] = useState('IDLE');
  const [battery, setBattery] = useState('--');
  const [voltage, setVoltage] = useState('--');
  
  const [isModalVisible, setModalVisible] = useState(false);

  const [products, setProducts] = useState([]);
  const [isStockModalVisible, setStockModalVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [quantity, setQuantity] = useState(1);
  const [qrList, setQrList] = useState([]); 
  const [currentQrIndex, setCurrentQrIndex] = useState(0); 

  const [coffeeSlot, setCoffeeSlot] = useState(1); 
  const [colaSlot, setColaSlot] = useState(3);     

  const [robotData, setRobotData] = useState({ x: 310, y: 350, heading: 0, path: [], obstacles: [] });
  const [targetPos, setTargetPos] = useState({ x: 310, y: 350 });

  const socketRef = useRef(null);
  const webViewRef = useRef(null); 
  
  const targetPosRef = useRef(targetPos);
  useEffect(() => {
    targetPosRef.current = targetPos;
  }, [targetPos]);

  // --- 🌐 관제 맵 HTML/CSS 설정 ---
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

        const mapImg = new Image();
        mapImg.crossOrigin = "Anonymous";
        mapImg.src = 'http://192.168.0.49:4000/assets/test_map.png';

        let currentRobot = { x: 310, y: 350, heading: -Math.PI / 2 };
        let targetRobot = { x: 310, y: 350, heading: -Math.PI / 2 };
        let state = { targetX: 310, targetY: 350, path: [], obstacles: [] };
        
        let camera = { x: 0, y: 0, scale: 1.0, rotation: 0, isCentered: false };
        let isDragging = false;
        let dragStart = { x: 0, y: 0 };
        let touchStartX = 0; let touchStartY = 0; let isMoved = false;
        
        let initialPinchDistance = null; let initialScale = 1;
        let initialPinchAngle = null; let initialRotation = 0;

        function resize() {
          canvas.width = window.innerWidth || 300;
          canvas.height = window.innerHeight || 300;

          if (!camera.isCentered && canvas.width > 0) {
            camera.x = (canvas.width / 2) - 310;
            camera.y = (canvas.height / 2) - 350;
            camera.isCentered = true;
          }
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
          if (e.shiftKey) {
            camera.rotation += (e.deltaY * 0.005);
          } else {
            const zoomAmount = 1 - (e.deltaY * 0.0015);
            camera.scale = Math.min(Math.max(camera.scale * zoomAmount, 0.4), 4);
          }
        }, { passive: false });

        canvas.addEventListener('touchstart', (e) => {
          if (e.touches.length === 1) {
            isMoved = false;
            touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY;
            dragStart.x = touchStartX - camera.x; dragStart.y = touchStartY - camera.y;
          } else if (e.touches.length === 2) {
            isMoved = true;
            const dx = e.touches[1].clientX - e.touches[0].clientX;
            const dy = e.touches[1].clientY - e.touches[0].clientY;
            
            initialPinchDistance = Math.hypot(dx, dy);
            initialPinchAngle = Math.atan2(dy, dx);
            initialScale = camera.scale;
            initialRotation = camera.rotation;
          }
        });
        
        canvas.addEventListener('touchmove', (e) => {
          e.preventDefault();
          if (e.touches.length === 1) {
            if (Math.hypot(e.touches[0].clientX - touchStartX, e.touches[0].clientY - touchStartY) > 5) isMoved = true;
            if (isMoved) { camera.x = e.touches[0].clientX - dragStart.x; camera.y = e.touches[0].clientY - dragStart.y; }
          } else if (e.touches.length === 2) {
            const dx = e.touches[1].clientX - e.touches[0].clientX;
            const dy = e.touches[1].clientY - e.touches[0].clientY;
            
            const currentDist = Math.hypot(dx, dy);
            const currentAngle = Math.atan2(dy, dx);
            
            camera.scale = Math.min(Math.max(initialScale * (currentDist / initialPinchDistance), 0.4), 4);
            camera.rotation = initialRotation + (currentAngle - initialPinchAngle);
          }
        }, { passive: false });
        
        canvas.addEventListener('touchend', (e) => {
          if (!isMoved && e.changedTouches.length === 1) handleMapClick(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
        });

        function handleMapClick(screenX, screenY) {
          const dx = (screenX - camera.x) / camera.scale;
          const dy = (screenY - camera.y) / camera.scale;
          
          const worldX = dx * Math.cos(-camera.rotation) - dy * Math.sin(-camera.rotation);
          const worldY = dx * Math.sin(-camera.rotation) + dy * Math.cos(-camera.rotation);
          
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
          ctx.rotate(camera.rotation);

          if (mapImg.complete) {
            ctx.globalAlpha = 0.8; 
            ctx.drawImage(mapImg, 0, 0, 600, 600); 
            ctx.globalAlpha = 1.0; 
          }

          const gridSize = 50;
          ctx.strokeStyle = '#ede8e0'; ctx.lineWidth = 1 / camera.scale;
          ctx.fillStyle = '#9e8c7a'; ctx.font = (10 / camera.scale) + 'px sans-serif';

          for (let x = -1000; x < 2000; x += gridSize) {
            ctx.beginPath(); ctx.moveTo(x, -1000); ctx.lineTo(x, 2000); ctx.stroke();
            if (x % 100 === 0 && x !== 0) ctx.fillText(x, x + 2, 12); 
          }
          for (let y = -1000; y < 2000; y += gridSize) {
            ctx.beginPath(); ctx.moveTo(-1000, y); ctx.lineTo(2000, y); ctx.stroke();
            if (y % 100 === 0 && y !== 0) ctx.fillText(y, 2, y - 2); 
          }

          ctx.strokeStyle = '#c47d4a'; ctx.lineWidth = 2 / camera.scale;
          ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(15, 0); ctx.moveTo(0, -15); ctx.lineTo(0, 15); ctx.stroke();

          if (state.path && state.path.length > 0) {
            ctx.strokeStyle = '#10b981'; ctx.lineWidth = 2.5 / camera.scale;
            ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(currentRobot.x, currentRobot.y);
            state.path.forEach(pt => ctx.lineTo(pt.x, pt.y));
            ctx.lineTo(state.targetX, state.targetY); ctx.stroke(); ctx.setLineDash([]);
          }

          if (state.obstacles && state.obstacles.length > 0) {
            state.obstacles.forEach(obs => {
              ctx.fillStyle = '#ef4444'; ctx.shadowColor = 'rgba(239, 68, 68, 0.3)'; ctx.shadowBlur = 4;
              ctx.beginPath(); ctx.arc(obs.x, obs.y, 4, 0, Math.PI * 2); ctx.fill();
            });
            ctx.shadowBlur = 0;
          }

          ctx.fillStyle = '#f97316'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1 / camera.scale;
          ctx.beginPath(); ctx.arc(state.targetX, state.targetY, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = 'rgba(249, 115, 22, 0.3)';
          ctx.beginPath(); ctx.arc(state.targetX, state.targetY, 12, 0, Math.PI * 2); ctx.stroke();

          ctx.save();
          ctx.translate(currentRobot.x, currentRobot.y);
          ctx.rotate(currentRobot.heading);

          ctx.fillStyle = '#c47d4a'; ctx.strokeStyle = '#3d2c1e'; ctx.lineWidth = 2 / camera.scale;
          ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

          ctx.fillStyle = '#3d2c1e';
          ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(3, -6); ctx.lineTo(3, 6); ctx.fill();

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

  // --- 소켓 및 ROS 설정 ---
  useEffect(() => {
    socketRef.current = io(SERVER_URL);

    socketRef.current.on('stock_updated', (data) => {
      setProducts(data.products);
      setSelectedProduct(prevSelected => {
        if (!prevSelected) return null;
        const updatedItem = data.products.find(p => p.id === prevSelected.id);
        if (updatedItem) {
          setQuantity(prevQ => Math.min(prevQ, updatedItem.stock > 0 ? Math.min(updatedItem.stock, 2) : 1));
          return updatedItem;
        }
        return null;
      });
    });

    socketRef.current.on('robot_position', (data) => {
      setRobotData(data);

      if (webViewRef.current) {
        webViewRef.current.postMessage(JSON.stringify({
          x: data.x, y: data.y, heading: data.heading, 
          targetX: targetPosRef.current.x, targetY: targetPosRef.current.y, 
          path: data.path, obstacles: data.obstacles
        }));
      }

      setStatus((prevStatus) => {
        if (prevStatus !== 'ARRIVED' && data.status === 'ARRIVED') {
          Vibration.vibrate(1000);
          Alert.alert("🤖 로봇 도착 완료!", `로봇이 지정하신 목적지에 도착했습니다.`);
        }
        return data.status;
      });
    });

    const rosWs = new WebSocket(ROSBRIDGE_URL);

    rosWs.onopen = () => {
      console.log('✅ ROS 웹소켓 브릿지 직접 연결 성공!');
      rosWs.send(JSON.stringify({ op: 'subscribe', topic: '/battery_state', type: 'sensor_msgs/BatteryState' }));
    };

    rosWs.onmessage = (event) => {
      try {
        const rosData = JSON.parse(event.data);
        if (rosData.op === 'publish' && rosData.topic === '/battery_state') {
          const message = rosData.msg;
          const percent = Math.round(message.percentage * 100);
          setBattery(percent);
          if (message.voltage) {
            setVoltage(message.voltage.toFixed(1));
          }
        }
      } catch (e) {
        console.error('ROS 메시지 파싱 에러:', e);
      }
    };

    rosWs.onerror = (error) => {
      console.error('❌ ROS 웹소켓 직접 연결 에러:', error);
    };

    return () => { 
      if (socketRef.current) socketRef.current.disconnect(); 
      if (rosWs.readyState === WebSocket.OPEN) {
        rosWs.send(JSON.stringify({ op: 'unsubscribe', topic: '/battery_state' }));
        rosWs.close();
      }
    };
  }, []);

  const handleWebViewMessage = (event) => {
    const data = JSON.parse(event.nativeEvent.data);
    if (data.type === 'MAP_CLICK') {
      setTargetPos({ x: data.x, y: data.y });
    }
  };

  const handleCallRobot = () => {
    if (!selectedProduct) { Alert.alert("알림", "🛒 [자판기 메뉴판]을 눌러 먼저 음료수를 골라주세요!"); return; }
    if (qrList.length === 0) { Alert.alert("알림", "💳 먼저 음료수 비용을 [결제 및 발급] 해주세요."); return; }
    if (socketRef.current) socketRef.current.emit('call_robot', { targetPos: targetPos, productId: selectedProduct.id });
  };

  const handleQRButtonPress = () => {
    if (!selectedProduct) { Alert.alert("알림", "구매할 음료를 먼저 선택해 주세요."); return; }
    if (qrList.length > 0) { 
      setModalVisible(true); 
    } else {
      Alert.alert("💳 결제 진행", `[${selectedProduct.name}] ${quantity}개를 결제하시겠습니까?`, [
        { text: "취소", style: "cancel" },
        { 
          text: "결제하기", 
          onPress: () => { 
            let generatedSlots = [];
            let tempCoffee = coffeeSlot;
            let tempCola = colaSlot;
            const productName = selectedProduct.name;

            for (let i = 0; i < quantity; i++) {
              if (productName.includes("레쓰비") || productName.includes("커피")) {
                generatedSlots.push(String(tempCoffee));
                tempCoffee = tempCoffee === 1 ? 2 : 1;
              } else if (productName.includes("콜라") || productName.includes("펩시")) {
                generatedSlots.push(String(tempCola));
                tempCola = tempCola === 3 ? 4 : 3;
              } else {
                generatedSlots.push("1");
              }
            }

            const combinedQrData = generatedSlots.join(",");

            setCoffeeSlot(tempCoffee);
            setColaSlot(tempCola);
            setQrList([combinedQrData]); 
            setCurrentQrIndex(0);    
            setModalVisible(true); 
          } 
        }
      ]);
    }
  };

  const handleItemReceived = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/api/products/purchase-complete`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selectedProduct.id,
          quantity: quantity,
          userName: user.name // ✅ 추가 — purchase_history 기록용 (웹 통계/등급 시스템 연동)
        })
      });
      
      const data = await response.json();
      if (data.success) {
        Alert.alert("수령 완료 🎉", "모든 음료 배송 및 수령이 완료되었습니다!");
        setQrList([]); 
        setSelectedProduct(null); 
        setQuantity(1);
        setModalVisible(false);
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
        <View style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.logoText}>PIMTO SYSTEM</Text>
              <Text style={styles.subtitleText}>자율주행 모빌리티 배송 플랫폼</Text>
            </View>
            <TouchableOpacity style={styles.logoutButton} onPress={() => setUser(null)}>
              <Text style={styles.logoutButtonText}>로그아웃</Text>
            </TouchableOpacity>
          </View>
          
          <View style={{ marginTop: 8, padding: 10, backgroundColor: '#f5f6f8', borderRadius: 6 }}>
            <Text style={{ color: '#4c4f69', fontWeight: 'bold', fontSize: 13, marginBottom: selectedProduct ? 6 : 0 }}>
              🥤 투입된 음료 선택 상태: {selectedProduct ? `${selectedProduct.icon} ${selectedProduct.name} (선택됨)` : '❌ 상품을 선택해 주세요'}
            </Text>
            {selectedProduct && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={{ fontSize: 12, color: '#666', fontWeight: '600' }}>주문 수량 조절:</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 4, borderWidth: 1, borderColor: '#e0e0e0' }}>
                  <TouchableOpacity style={{ paddingHorizontal: 12, paddingVertical: 4 }} onPress={() => setQuantity(q => Math.max(1, q - 1))}>
                    <Text style={{ fontWeight: 'bold', color: '#c47d4a' }}>-</Text>
                  </TouchableOpacity>
                  <Text style={{ paddingHorizontal: 10, fontWeight: 'bold', color: '#3d2c1e' }}>{quantity}</Text>
                  <TouchableOpacity 
                    style={{ paddingHorizontal: 12, paddingVertical: 4 }} 
                    onPress={() => {
                      const maxLimit = Math.min(selectedProduct.stock, 2);
                      if (quantity >= maxLimit) {
                        if (selectedProduct.stock < 2) {
                          Alert.alert("재고 부족", "현재 자판기에 남은 수량이 1개뿐입니다.");
                        } else {
                          Alert.alert("수량 제한", "자판기 구조상 한 번에 최대 2개까지만 구매할 수 있습니다.");
                        }
                      } else {
                        setQuantity(q => q + 1);
                      }
                    }}
                  >
                    <Text style={{ fontWeight: 'bold', color: '#c47d4a' }}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          <View style={{ flexDirection: 'row', marginTop: 10, gap: 8 }}>
            <View style={styles.statusBadge}>
              <View style={[styles.statusDot, status === 'MOVING' ? { backgroundColor: '#00ff9d' } : { backgroundColor: '#ff9e64' }]} />
              <Text style={styles.statusText}>상태: {status === 'MOVING' ? '🚀 배송중' : status === 'ARRIVED' ? '✅ 도착함' : '💤 대기중'}</Text>
            </View>
            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>
                {battery !== '--' && battery <= 20 ? '🪫' : '🔋'} 배터리: {battery}{battery !== '--' ? '%' : ''} {voltage !== '--' ? `(${voltage}V)` : ''}
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>📡 ROS LiDAR 격자 맵</Text>
        <View style={styles.mapContainer}>
          <WebView
            ref={webViewRef}
            originWhitelist={['*']}
            source={{ html: mapHtml }}
            onMessage={handleWebViewMessage}
            style={{ flex: 1, backgroundColor: 'transparent' }} 
            scrollEnabled={false}
            javaScriptEnabled={true}
            mixedContentMode='always'
          />
        </View>
        <Text style={styles.tipText}>💡 마우스 휠 또는 멀티터치로 줌인/아웃이 유연하게 연동됩니다.</Text>

        <View style={styles.controlPanel}>
          <View style={styles.coordInfoRow}>
            <Text style={styles.coordLabel}>하차 지정 좌표 (Target)</Text>
            <Text style={styles.coordValue}>X: {Math.round(targetPos.x)} · Y: {Math.round(targetPos.y)}</Text>
          </View>
          
          <TouchableOpacity style={styles.callButton} onPress={handleCallRobot}>
            <Text style={styles.callButtonText}>🤖 지정한 위치로 자판기 로봇 출발시키기</Text>
          </TouchableOpacity>
          
          <View style={styles.subButtonRow}>
            <TouchableOpacity style={styles.subButton} onPress={fetchProducts}>
              <Text style={styles.subButtonText}>🛒 자판기 메뉴판</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={[styles.subButton, qrList.length > 0 ? styles.qrActiveButton : null]} onPress={handleQRButtonPress}>
              <Text style={[styles.subButtonText, qrList.length > 0 ? styles.qrActiveText : null]}>
                {qrList.length > 0 ? "📱 인증용 통합 QR 보기" : "💳 결제 및 발급"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ✅ 채팅 버튼 (문의하기 대체) */}
          <TouchableOpacity
            style={[styles.subButton, { marginTop: 8, flex: 1, width: '100%' }]}
            onPress={onChat}
          >
            <Text style={styles.subButtonText}>💬 고객지원 채팅</Text>
          </TouchableOpacity>
        </View>

        <Modal visible={isModalVisible} transparent={true} animationType="fade">
          <View style={styles.modalBackground}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>✅ 자판기 결제 승인 완료!</Text>
              <Text style={{ marginBottom: 15, color: '#666', textAlign: 'center' }}>
                로봇이 도착하면 아래 QR을 카메라에 한 번만 인식시키세요.
              </Text>
              
              <View style={styles.qrWrapper}>
                {qrList.length > 0 && <QRCode value={qrList[currentQrIndex]} size={180} />}
              </View>
              
              <Text style={{ marginVertical: 12, fontWeight: 'bold', color: '#c47d4a', fontSize: 15, textAlign: 'center' }}>
                🥤 [{selectedProduct?.name}] {quantity}개 배출용 통합 QR
              </Text>

              <TouchableOpacity style={styles.finishButton} onPress={handleItemReceived}>
                <Text style={styles.finishButtonText}>🎁 모든 음료 수령 완료 및 QR 폐기</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.closeButton} onPress={() => setModalVisible(false)}>
                <Text style={styles.closeButtonText}>창 닫기</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Modal visible={isStockModalVisible} transparent={true} animationType="slide">
          <View style={styles.modalBackground}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>🥤 자판기 메뉴판</Text>
              <ScrollView style={{ width: '100%', maxHeight: 300, marginBottom: 20 }}>
                {products.map((item) => (
                  <TouchableOpacity key={item.id} style={[styles.productItem, selectedProduct?.id === item.id ? { borderColor: '#7aa2f7', borderWidth: 2 } : null]} onPress={() => { setSelectedProduct(item); setQuantity(1); setStockModalVisible(false); }}>
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
              <TouchableOpacity style={styles.closeButton} onPress={() => setStockModalVisible(false)}>
                <Text style={styles.closeButtonText}>닫기</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}