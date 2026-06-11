// frontend/screens/MainScreen.js
import React, { useState, useEffect, useRef } from 'react';
import { View, Image, TouchableOpacity, Text, SafeAreaView, Alert, Modal, Vibration, ScrollView } from 'react-native';
import { io } from 'socket.io-client';
import QRCode from 'react-native-qrcode-svg';
import styles from '../styles/MainStyles';

const SERVER_URL = 'http://192.168.0.63:4000';

export default function MainScreen({ user, setUser }) {
  // --- [로봇 관제 및 결제 상태] ---
  const [robotPos, setRobotPos] = useState({ x: 120, y: 180 });
  const [targetPos, setTargetPos] = useState({ x: 120, y: 180 });
  const [status, setStatus] = useState('IDLE');
  const [battery, setBattery] = useState(100);
  const [qrValue, setQrValue] = useState(null);
  const [isModalVisible, setModalVisible] = useState(false);

  // --- [상품 목록 및 선택 상태] ---
  const [products, setProducts] = useState([]);
  const [isStockModalVisible, setStockModalVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null); // 💡 선택된 상품 객체 통째로 관리

  const socketRef = useRef(null);

  // --- [실시간 소켓 연결] ---
  useEffect(() => {
    socketRef.current = io(SERVER_URL);
    socketRef.current.on('robot_position', (data) => {
      setRobotPos({ x: data.x, y: data.y });
      if (data.battery !== undefined) setBattery(data.battery);

      setStatus((prevStatus) => {
        if (prevStatus !== 'ARRIVED' && data.status === 'ARRIVED') {
          Vibration.vibrate(1000);
          Alert.alert("🤖 로봇 도착 완료!", `로봇이 도착했습니다.\n현재 배터리 잔량: ${data.battery}%`, [{ text: "확인" }]);
        }
        return data.status;
      });
    });

    return () => { if (socketRef.current) socketRef.current.disconnect(); };
  }, []);

  // --- [관제 및 결제 함수] ---
  const handleMapPress = (event) => {
    const { locationX, locationY } = event.nativeEvent;
    setTargetPos({ x: locationX - 13, y: locationY - 13 }); 
  };

  // 💡 로봇 호출 시 예외 처리 및 상품 ID 결합 송신하도록 수정
  const handleCallRobot = () => {
    if (!selectedProduct) {
      Alert.alert("알림", "🛒 하단의 [재고 보기]를 통해 드실 음료를 먼저 선택해 주세요.");
      return;
    }
    if (!qrValue) {
      Alert.alert("알림", "💳 [결제 및 발급] 버튼을 눌러 모바일 인증 티켓을 먼저 생성해 주세요.");
      return;
    }

    if (socketRef.current) {
      // 좌표 정보와 선택한 음료의 ID를 한데 모아 백엔드로 던집니다.
      socketRef.current.emit('call_robot', {
        targetPos: targetPos,
        productId: selectedProduct.id
      });
    }
  };

  // 💡 선택된 음료가 있는지 유효성 검사 추가
  const handleQRButtonPress = () => {
    if (!selectedProduct) {
      Alert.alert("알림", "구매할 음료를 먼저 선택해 주세요.");
      return;
    }

    if (qrValue) {
      setModalVisible(true);
    } else {
      Alert.alert("💳 결제 진행", `[${selectedProduct.name}] 상품을 결제하고 QR 코드를 생성하시겠습니까?`, [
        { text: "취소", style: "cancel" },
        { 
          text: "결제하기", 
          onPress: () => { 
            setQrValue("PIMTO-" + Math.floor(Math.random() * 100000)); 
            setModalVisible(true); 
          } 
        }
      ]);
    }
  };

  // 💡 [물건 수령 완료] 버튼 터치 시 실제 DB 반영 백엔드 연동 호출
  const handleItemReceived = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/api/products/purchase-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();

      if (data.success) {
        Alert.alert("수령 완료 🎉", "음료 배송 정산이 성공적으로 반영되었습니다. 맛있게 드세요!");
        setQrValue(null); 
        setSelectedProduct(null); // 사용 완료 후 선택 음료 리셋
        setModalVisible(false);
      } else {
        Alert.alert("처리 실패", data.message);
      }
    } catch (error) {
      Alert.alert("오류", "서버와 통신하는 중 문제가 발생했습니다.");
    }
  };

  // --- [DB에서 실시간 상품 조회] ---
  const fetchProducts = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/api/products`);
      const data = await response.json();
      if (data.success) {
        setProducts(data.products);
        setStockModalVisible(true); 
      } else {
        Alert.alert("오류", "상품을 불러오지 못했습니다.");
      }
    } catch (error) {
      Alert.alert("네트워크 오류", "서버와 연결할 수 없습니다.");
    }
  };

  // 상품 리스트 모달 안에서 아이템을 클릭했을 때 처리
  const handleSelectProduct = (product) => {
    if (product.stock <= 0) {
      Alert.alert("품절", "현재 재고가 없는 상품은 선택할 수 없습니다.");
      return;
    }
    setSelectedProduct(product);
    setStockModalVisible(false); // 선택 완료 시 모달 닫기
    Alert.alert("선택 완료 완료 👍", `[${product.name}] 상품이 지정되었습니다. 이제 결제 및 호출을 진행하세요.`);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        
        {/* --- [헤더 영역] --- */}
        <View style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.logoText}>PIMTO</Text>
              <Text style={styles.subtitleText}>이동식 로봇 자판기 관제 시스템</Text>
            </View>
            <TouchableOpacity style={styles.logoutButton} onPress={() => setUser(null)}>
              <Text style={styles.logoutButtonText}>로그아웃</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.welcomeText}>안녕하세요, {user.name}님 👋</Text>
          
          {/* 💡 상단에 현재 어떤 음료를 골랐는지 실시간 안내 텍스트 탑재 */}
          <Text style={{ marginTop: 5, color: '#3d2c1e', fontWeight: 'bold', fontSize: 13 }}>
            🛒 선택된 상품: {selectedProduct ? `${selectedProduct.icon} ${selectedProduct.name}` : '선택 없음 (하단 메뉴에서 선택)'}
          </Text>

          <View style={{ flexDirection: 'row', marginTop: 10, gap: 8 }}>
            <View style={styles.statusBadge}>
              <View style={[styles.statusDot, status === 'MOVING' ? { backgroundColor: '#2ecc71' } : null]} />
              <Text style={styles.statusText}>상태: {status}</Text>
            </View>
            <View style={[styles.statusBadge, battery < 20 ? { backgroundColor: '#ffe6e6' } : null]}>
              <Text style={[styles.statusText, battery < 20 ? { color: '#e74c3c' } : null]}>🔋 배터리: {battery}%</Text>
            </View>
          </View>
        </View>

        {/* --- [지도 영역] --- */}
        <Text style={styles.sectionTitle}>📍 자판기 위치 및 호출 지정</Text>
        <TouchableOpacity activeOpacity={1} onPress={handleMapPress} style={styles.mapContainer}>
          <Image source={require('../assets/map.png')} style={styles.mapImage} />
          <View style={[styles.targetDot, { left: targetPos.x + 10, top: targetPos.y + 10 }]} />
          <View style={[styles.robot, { left: robotPos.x, top: robotPos.y }]} />
        </TouchableOpacity>
        <Text style={styles.tipText}>💡 지도를 터치하여 로봇을 부를 목적지를 지정하세요.</Text>

        {/* --- [하단 컨트롤 패널] --- */}
        <View style={styles.controlPanel}>
          <View style={styles.coordInfoRow}>
            <Text style={styles.coordLabel}>목적지 좌표</Text>
            <Text style={styles.coordValue}>X: {Math.round(targetPos.x)}px · Y: {Math.round(targetPos.y)}px</Text>
          </View>
          <TouchableOpacity style={styles.callButton} onPress={handleCallRobot}>
            <Text style={styles.callButtonText}>🤖 이 위치로 로봇 호출하기</Text>
          </TouchableOpacity>
          <View style={styles.subButtonRow}>
            <TouchableOpacity style={styles.subButton} onPress={fetchProducts}>
              <Text style={styles.subButtonText}>🛒 재고 보기</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.subButton, qrValue ? styles.qrActiveButton : null]} onPress={handleQRButtonPress}>
              <Text style={[styles.subButtonText, qrValue ? styles.qrActiveText : null]}>{qrValue ? "📱 내 인증 QR 보기" : "💳 결제 및 발급"}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* --- [기존 모달: QR 결제 및 수령] --- */}
        <Modal visible={isModalVisible} transparent={true} animationType="fade">
          <View style={styles.modalBackground}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>✅ 준비 완료!</Text>
              <Text style={styles.modalSubtitle}>로봇이 도착하면 아래 QR을 스캔해주세요.</Text>
              <View style={styles.qrWrapper}>
                {qrValue && <QRCode value={qrValue} size={180} color="#3d2c1e" />}
              </View>
              {selectedProduct && <Text style={{fontWeight: 'bold', marginVertical: 5}}>수령 상품: {selectedProduct.icon} {selectedProduct.name}</Text>}
              <Text style={styles.orderNumberText}>주문번호: {qrValue}</Text>
              <TouchableOpacity style={styles.closeButton} onPress={() => setModalVisible(false)}>
                <Text style={styles.closeButtonText}>창 닫고 지도 보기 (유지됨)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.finishButton} onPress={handleItemReceived}>
                <Text style={styles.finishButtonText}>🎁 물건 수령 완료 (QR 폐기 & 재고 차감)</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* --- [추가된 모달: 실시간 재고 확인 및 상품 선택] --- */}
        <Modal visible={isStockModalVisible} transparent={true} animationType="slide">
          <View style={styles.modalBackground}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>🛒 실시간 재고 현황</Text>
              <Text style={styles.modalSubtitle}>구매할 음료수를 터치하여 선택하세요.</Text>

              <ScrollView style={{ width: '100%', maxHeight: 300, marginBottom: 20 }}>
                {products.map((item) => (
                  /* 💡 단순 View였던 레이아웃을 클릭 가능한 TouchableOpacity로 변경하여 상품 선택 기능 부여 */
                  <TouchableOpacity 
                    key={item.id} 
                    style={[
                      styles.productItem, 
                      selectedProduct?.id === item.id ? { borderColor: '#2ecc71', borderWidth: 2, borderRadius: 10 } : null
                    ]}
                    onPress={() => handleSelectProduct(item)}
                  >
                    <Text style={styles.productIcon}>{item.icon}</Text>
                    <View style={styles.productInfo}>
                      <Text style={styles.productName}>{item.name}</Text>
                      <Text style={styles.productPrice}>{item.price.toLocaleString()}원</Text>
                    </View>
                    <View style={[styles.stockBadge, item.stock === 0 ? { backgroundColor: '#ffe6e6' } : null]}>
                      <Text style={[styles.stockText, item.stock === 0 ? { color: '#e74c3c' } : null]}>
                        {item.stock > 0 ? `${item.stock}개 남음` : '품절'}
                      </Text>
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