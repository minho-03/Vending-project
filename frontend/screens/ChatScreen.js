// frontend/screens/ChatScreen.js
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, SafeAreaView, TouchableOpacity, TextInput,
  FlatList, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform
} from 'react-native';
import { io } from 'socket.io-client';

const SERVER_URL = 'http://192.168.0.62:4000';

export default function ChatScreen({ user, onBack }) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    // 소켓 연결
    socketRef.current = io(SERVER_URL);

    // 채팅방 입장 (username 등록)
    socketRef.current.emit('chat_join', { userId: user.userId });

    // 이전 대화 내역 수신
    socketRef.current.on('chat_history', (data) => {
      setMessages(data.messages || []);
      setLoading(false);
    });

    // 새 메시지 수신 (관리자 또는 본인)
    socketRef.current.on('chat_message', (data) => {
      setMessages(prev => [...prev, data]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    });

    return () => {
      socketRef.current?.emit('chat_leave', { userId: user.userId });
      socketRef.current?.disconnect();
    };
  }, []);

  const handleSend = () => {
    if (!inputText.trim()) return;
    socketRef.current?.emit('chat_send', {
      userId: user.userId,
      content: inputText.trim()
    });
    setInputText('');
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const renderMessage = ({ item }) => {
    const isMine = !item.fromAdmin;
    return (
      <View style={[styles.msgRow, isMine ? styles.msgRowMine : styles.msgRowAdmin]}>
        {!isMine && (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>관</Text>
          </View>
        )}
        <View style={[styles.msgContent, isMine ? styles.msgContentMine : null]}>
          {!isMine && <Text style={styles.sender}>관리자</Text>}
          <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleAdmin]}>
            <Text style={[styles.bubbleText, isMine ? styles.bubbleTextMine : styles.bubbleTextAdmin]}>
              {item.content}
            </Text>
          </View>
          <Text style={styles.time}>{formatTime(item.created_at || item.time)}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* 헤더 */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← 뒤로</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>💬 PIMTO 고객지원</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* 메시지 목록 */}
        {loading ? (
          <ActivityIndicator size="large" color="#c47d4a" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item, idx) => String(item.id || idx)}
            renderItem={renderMessage}
            contentContainerStyle={styles.msgList}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>아직 대화가 없어요 😊</Text>
                <Text style={styles.emptySubText}>먼저 말을 걸어보세요!</Text>
              </View>
            }
          />
        )}

        {/* 입력창 */}
        <View style={styles.footer}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="메시지를 입력하세요..."
            placeholderTextColor="#c4b09a"
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />
          <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
            <Text style={styles.sendBtnText}>전송</Text>
          </TouchableOpacity>
        </View>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#faf8f4' },

  // 헤더
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#3d2c1e' },
  backBtn: { padding: 4 },
  backBtnText: { color: '#faf8f4', fontSize: 14, fontWeight: '600' },
  headerTitle: { fontSize: 15, fontWeight: '700', color: '#faf8f4' },

  // 메시지 목록
  msgList: { padding: 16, gap: 12, flexGrow: 1 },
  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 80 },
  emptyText: { fontSize: 16, color: '#9e8c7a', fontWeight: '600', marginBottom: 6 },
  emptySubText: { fontSize: 13, color: '#c4b09a' },

  // 메시지 행
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 8 },
  msgRowMine: { flexDirection: 'row-reverse' },
  msgRowAdmin: {},
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#9e8c7a', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: 'white', fontSize: 11, fontWeight: '700' },
  msgContent: { maxWidth: '75%', gap: 3 },
  msgContentMine: { alignItems: 'flex-end' },
  sender: { fontSize: 11, color: '#9e8c7a', fontWeight: '600', marginBottom: 2 },
  bubble: { padding: 10, borderRadius: 14 },
  bubbleAdmin: { backgroundColor: 'white', borderWidth: 1, borderColor: '#e8dfd4', borderTopLeftRadius: 3 },
  bubbleMine: { backgroundColor: '#c47d4a', borderTopRightRadius: 3 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleTextAdmin: { color: '#3d2c1e' },
  bubbleTextMine: { color: 'white' },
  time: { fontSize: 10, color: '#b0a090' },

  // 입력창
  footer: { flexDirection: 'row', padding: 12, backgroundColor: 'white', borderTopWidth: 1, borderTopColor: '#e8dfd4', gap: 8, alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#faf6f0', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, color: '#3d2c1e', borderWidth: 1, borderColor: '#e8dfd4' },
  sendBtn: { backgroundColor: '#3d2c1e', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  sendBtnText: { color: 'white', fontSize: 13, fontWeight: '700' },
});