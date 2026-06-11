import React, { useState } from 'react';
import LoginScreen from './screens/LoginScreen';
import MainScreen from './screens/MainScreen';
import AdminScreen from './screens/AdminScreen';

export default function App() {
  const [user, setUser] = useState(null);

  // 1. 유저 정보가 없으면 로그인 화면
  if (!user) {
    return <LoginScreen setUser={setUser} />;
  }

  // 2. 유저의 role이 'admin'이면 관리자 전용 대시보드 화면
  if (user.role === 'admin') {
    return <AdminScreen user={user} setUser={setUser} />;
  }

  // 3. 일반 유저면 기존 로봇 관제 메인 화면
  return <MainScreen user={user} setUser={setUser} />;
}