import React, { useState } from 'react';
import LoginScreen from './screens/LoginScreen';
import MainScreen from './screens/MainScreen';
import AdminScreen from './screens/AdminScreen';
import ChatScreen from './screens/ChatScreen'; // ✅ 문의 → 채팅으로 교체

export default function App() {
  const [user, setUser] = useState(null);
  const [showChat, setShowChat] = useState(false); // ✅ showInquiry → showChat

  // 1. 로그인 화면
  if (!user) {
    return <LoginScreen setUser={setUser} />;
  }

  // 2. 채팅 화면
  if (showChat) {
    return <ChatScreen user={user} onBack={() => setShowChat(false)} />;
  }

  // 3. 관리자 화면
  if (user.role === 'admin') {
    return <AdminScreen user={user} setUser={setUser} />;
  }

  // 4. 일반 유저 메인 화면
  return <MainScreen user={user} setUser={setUser} onChat={() => setShowChat(true)} />;
}