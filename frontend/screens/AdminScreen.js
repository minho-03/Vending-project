// frontend/screens/AdminScreen.js
import React, { useState, useEffect } from 'react';
import { View, Text, SafeAreaView, TouchableOpacity, ScrollView, Alert, RefreshControl, TextInput, StyleSheet } from 'react-native';
import styles from '../styles/AdminStyles';

const SERVER_URL = 'http://192.168.0.70:4000';

export default function AdminScreen({ user, setUser }) {
  const [products, setProducts] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  // --- [새 메뉴 입력창을 위한 상태] ---
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newIcon, setNewIcon] = useState('🥤'); 

  // --- 📊 [신규 추가] 실시간 통계 상태 ---
  const [stats, setStats] = useState({ totalRevenue: 0, bestSeller: '기록 없음' });

  // 상품 데이터 가져오기
  const fetchInventory = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/api/products`);
      const data = await response.json();
      if (data.success) {
        setProducts(data.products);
      }
    } catch (error) {
      console.error("데이터 로딩 실패", error);
    }
  };

  // 📊 [신규 추가] 통계 데이터 가져오기 함수
  const fetchAdminStats = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/api/admin/stats`);
      const data = await response.json();
      if (data.success) {
        setStats({ totalRevenue: data.totalRevenue, bestSeller: data.bestSeller });
      }
    } catch (error) {
      console.error("통계 데이터 로딩 실패", error);
    }
  };

  // 화면 진입 시 두 가지 정보를 동시에 가져옵니다
  useEffect(() => {
    fetchInventory();
    fetchAdminStats();
  }, []);

  // 당겨서 새로고침할 때 재고와 매출 통계 모두 리프레시
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchInventory(), fetchAdminStats()]);
    setRefreshing(false);
  };

  // 재고 추가 로직
  const handleRestock = async (productId) => {
    try {
      const response = await fetch(`${SERVER_URL}/api/products/restock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId })
      });
      const data = await response.json();
      if (data.success) {
        setProducts(products.map(p => p.id === productId ? { ...p, stock: p.stock + 1 } : p));
      }
    } catch (error) {
      Alert.alert("오류", "재고를 추가하지 못했습니다.");
    }
  };

  // 새 메뉴 등록 로직
  const handleAddProduct = async () => {
    if (!newName || !newPrice) {
      Alert.alert("알림", "상품 이름과 가격을 입력해주세요.");
      return;
    }

    try {
      const response = await fetch(`${SERVER_URL}/api/products/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          price: parseInt(newPrice),
          stock: 2, 
          icon: newIcon
        })
      });
      const data = await response.json();

      if (data.success) {
        Alert.alert("성공 🎉", `${newName} 메뉴가 추가되었습니다.`);
        setNewName('');
        setNewPrice('');
        setNewIcon('🥤');
        fetchInventory();
      } else {
        Alert.alert("실패", data.message);
      }
    } catch (error) {
      Alert.alert("오류", "서버와 통신 중 문제가 발생했습니다.");
    }
  };

  // 상품 삭제 로직
  const handleDeleteProduct = (productId, productName) => {
    Alert.alert(
      "⚠️ 상품 삭제",
      `[${productName}] 메뉴를 메뉴판에서 완전히 삭제하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        { 
          text: "삭제하기", 
          style: "destructive",
          onPress: async () => {
            try {
              const response = await fetch(`${SERVER_URL}/api/products/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productId })
              });
              const data = await response.json();

              if (data.success) {
                Alert.alert("삭제 완료", "메뉴가 성공적으로 삭제되었습니다.");
                fetchInventory(); 
              } else {
                Alert.alert("오류", data.message);
              }
            } catch (error) {
              Alert.alert("오류", "서버와 통신 중 문제가 발생했습니다.");
            }
          }
        }
      ]
    );
  };

  // 로봇 원격 강제 리셋 제어 함수
  const handleForceReset = () => {
  Alert.alert(
    "🏠 홈 복귀",
    "로봇을 즉시 홈 기지로 복귀시키겠습니까?",
    [
      { text: "취소", style: "cancel" },
      { 
        text: "홈 복귀", 
        onPress: async () => {
          try {
            const response = await fetch(`${SERVER_URL}/api/admin/robot/force-reset`, { method: 'POST' });
            const data = await response.json();
            if (data.success) {
              Alert.alert("완료", "로봇이 홈 기지로 복귀합니다.");
            }
          } catch (error) {
            Alert.alert("오류", "서버와 통신 실패");
          }
        }
      }
    ]
  );
};

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        
        {/* 헤더 */}
        <View style={styles.header}>
          <Text style={styles.adminTitle}>PIMTO Dashboard</Text>
          <TouchableOpacity style={styles.logoutButton} onPress={() => setUser(null)}>
            <Text style={styles.logoutText}>로그아웃</Text>
          </TouchableOpacity>
        </View>

        <ScrollView 
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          showsVerticalScrollIndicator={false}
        >
          {/* 시스템 요약 카드 */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>관리자 계정</Text>
            <Text style={styles.summaryValue}>{user.name} 님</Text>
            <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 10 }} />
            <Text style={styles.summaryTitle}>전체 운영 상품 수</Text>
            <Text style={styles.summaryValue}>{products.length} 종</Text>
          </View>

          {/* 📊 [신규 추가] 실시간 판매 매출 통계 대시보드 판넬 */}
          <Text style={styles.sectionTitle}>📊 실시간 판매 통계</Text>
          <View style={localStyles.statsCard}>
            <View style={{ flex: 1 }}>
              <Text style={localStyles.statsLabel}>💰 누적 총 매출액</Text>
              <Text style={localStyles.statsValue}>{stats.totalRevenue.toLocaleString()} 원</Text>
            </View>
            <View style={{ width: 1, backgroundColor: '#eee', marginHorizontal: 15 }} />
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <Text style={localStyles.statsLabel}>👑 최다 판매 음료</Text>
              <Text style={[localStyles.statsValue, { fontSize: 13, marginTop: 4, color: '#34495e' }]}>
                {stats.bestSeller}
              </Text>
            </View>
          </View>

          {/* 새 메뉴 등록 폼 */}
          <Text style={styles.sectionTitle}>✨ 새 메뉴 추가하기</Text>
          <View style={localStyles.formCard}>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              <TextInput 
                style={[localStyles.input, { flex: 1.5 }]} 
                placeholder="음료명 (예: 사이다)" 
                value={newName}
                onChangeText={setNewName}
              />
              <TextInput 
                style={[localStyles.input, { flex: 1 }]} 
                placeholder="가격 (원)" 
                keyboardType="numeric"
                value={newPrice}
                onChangeText={setNewPrice}
              />
              <TextInput 
                style={[localStyles.input, { flex: 0.8, textAlign: 'center' }]} 
                placeholder="이모지" 
                value={newIcon}
                onChangeText={setNewIcon}
              />
            </View>
            <TouchableOpacity style={localStyles.submitButton} onPress={handleAddProduct}>
              <Text style={localStyles.submitButtonText}>➕ 이 메뉴판 등록하기</Text>
            </TouchableOpacity>
          </View>

          {/* 실시간 재고 관리 리스트 */}
          <Text style={styles.sectionTitle}>📦 실시간 재고 관리</Text>
          {products.map((item) => (
            <View key={item.id} style={styles.productCard}>
              <Text style={styles.iconWrapper}>{item.icon}</Text>
              <View style={styles.infoWrapper}>
                <Text style={styles.nameText}>{item.name}</Text>
                <Text style={[styles.stockText, item.stock < 3 ? { color: '#e74c3c', fontWeight: '700' } : null]}>
                  현재 재고: {item.stock}개 · {item.price.toLocaleString()}원
                </Text>
              </View>
              
              {/* 버튼 그룹 영역 */}
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity style={styles.restockButton} onPress={() => handleRestock(item.id)}>
                  <Text style={styles.restockButtonText}>재고 +1</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.restockButton, { backgroundColor: '#e74c3c' }]} 
                  onPress={() => handleDeleteProduct(item.id, item.name)}
                >
                  <Text style={styles.restockButtonText}>삭제</Text>
                </TouchableOpacity>
              </View>

            </View>
          ))}
          
          {/* 🚨 [신규 추가] 비상 위기 대응 마스터 강제 제어 버튼 */}
          <TouchableOpacity style={localStyles.homeButton} onPress={handleForceReset}>
            <Text style={localStyles.homeButtonText}>🚨 로봇 긴급 홈 복귀</Text>
          </TouchableOpacity>

          <Text style={styles.footerTip}>화면을 아래로 당기면 새로고침 됩니다.</Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const localStyles = StyleSheet.create({
  formCard: { backgroundColor: '#fff', padding: 15, borderRadius: 15, marginBottom: 25, borderWidth: 1, borderColor: '#eee' },
  input: { backgroundColor: '#f1f2f6', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, fontSize: 14, color: '#2c3e50' },
  submitButton: { backgroundColor: '#2ecc71', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  submitButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  
  // 📊 실시간 대시보드 스타일 필드
  statsCard: { flexDirection: 'row', backgroundColor: '#fff', padding: 15, borderRadius: 15, marginBottom: 25, borderWidth: 1, borderColor: '#eee' },
  statsLabel: { color: '#7f8c8d', fontSize: 12, fontWeight: '600' },
  statsValue: { color: '#2c3e50', fontSize: 18, fontWeight: 'bold', marginTop: 2 },
  
  // 🚨 긴급 마스터 비상 버튼 디자인
  homeButton: { backgroundColor: '#3d2c1e', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 20, marginBottom: 5 },
  homeButtonText: { color: '#fff', fontWeight: '800', fontSize: 14 }
});