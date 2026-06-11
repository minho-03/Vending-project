// frontend/styles/AdminStyles.js
import { StyleSheet } from 'react-native';

export default StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f8f9fa' },
  container: { flex: 1, padding: 20 },
  
  // 헤더
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25 },
  adminTitle: { fontSize: 24, fontWeight: '900', color: '#2c3e50' },
  logoutButton: { backgroundColor: '#e9cebd', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  logoutText: { color: '#8a6d5c', fontSize: 13, fontWeight: '600' },

  // 시스템 현황 요약 카드
  summaryCard: { backgroundColor: '#2c3e50', padding: 20, borderRadius: 18, marginBottom: 25 },
  summaryTitle: { color: '#bdc3c7', fontSize: 13, marginBottom: 5 },
  summaryValue: { color: '#fff', fontSize: 20, fontWeight: '700' },

  // 상품 관리 리스트
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#34495e', marginBottom: 15 },
  productCard: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#fff', 
    padding: 18, 
    borderRadius: 15, 
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eee',
    // 그림자
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  iconWrapper: { fontSize: 32, marginRight: 15 },
  infoWrapper: { flex: 1 },
  nameText: { fontSize: 16, fontWeight: '700', color: '#2c3e50' },
  stockText: { fontSize: 14, color: '#7f8c8d', marginTop: 2 },
  
  // 재고 추가 버튼
  restockButton: { 
    backgroundColor: '#3498db', 
    paddingHorizontal: 15, 
    paddingVertical: 10, 
    borderRadius: 10 
  },
  restockButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  
  // 하단 팁
  footerTip: { textAlign: 'center', color: '#bdc3c7', fontSize: 12, marginTop: 10 }
});