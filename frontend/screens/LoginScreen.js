import React, { useState } from 'react';
import { StyleSheet, View, Text, SafeAreaView, Alert, TextInput, TouchableOpacity } from 'react-native';
import styles from '../styles/LoginStyles';

const SERVER_URL = 'http://192.168.0.62:4000';

export default function LoginScreen({ setUser }) {
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const handleLogin = async () => {
    if (!userId || !password) {
      Alert.alert("알림", "아이디와 비밀번호를 모두 입력해주세요.");
      return;
    }
    try {
      const response = await fetch(`${SERVER_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, password })
      });
      const data = await response.json();
      if (data.success) {
        setUser(data.user); // 성공 시 App.js로 유저 정보 전달 (화면 전환됨)
        Alert.alert("환영합니다", `${data.user.name}님, 좋은 하루 되세요 ☕`);
      } else {
        Alert.alert("로그인 실패", data.message);
      }
    } catch (error) {
      Alert.alert("오류", "서버와 통신할 수 없습니다.");
    }
  };

  const handleSignUp = async () => {
    if (!userId || !password || !name) {
      Alert.alert("알림", "모든 칸을 입력해주세요.");
      return;
    }
    try {
      const response = await fetch(`${SERVER_URL}/api/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, password, name })
      });
      const data = await response.json();
      if (data.success) {
        Alert.alert("가입 완료", "회원가입이 완료되었습니다. 로그인해 주세요!");
        setIsSignUpMode(false);
        setPassword('');
      } else {
        Alert.alert("회원가입 실패", data.message);
      }
    } catch (error) {
      Alert.alert("오류", "서버와 통신할 수 없습니다.");
    }
  };

  return (
    <SafeAreaView style={styles.loginContainer}>
      <View style={styles.loginContent}>
        <Text style={styles.loginLogo}>PIMTO</Text>
        <Text style={styles.loginTagline}>이동식 로봇 자판기 서비스</Text>
        <Text style={styles.loginTitle}>{isSignUpMode ? "새로운 계정 만들기" : ""}</Text>
        
        <View style={styles.formContainer}>
          {isSignUpMode && (
            <TextInput 
              style={styles.input} 
              placeholder="이름을 입력하세요"
              placeholderTextColor="#c4b09a"
              value={name}
              onChangeText={setName}
            />
          )}
          <TextInput 
            style={styles.input} 
            placeholder="아이디를 입력하세요"
            placeholderTextColor="#c4b09a"
            autoCapitalize="none"
            value={userId}
            onChangeText={setUserId}
          />
          <TextInput 
            style={styles.input} 
            placeholder="비밀번호를 입력하세요"
            placeholderTextColor="#c4b09a"
            secureTextEntry={true}
            value={password}
            onChangeText={setPassword}
          />

          <TouchableOpacity style={styles.primaryButton} onPress={isSignUpMode ? handleSignUp : handleLogin}>
            <Text style={styles.primaryButtonText}>{isSignUpMode ? "가입하기" : "로그인"}</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.switchButton} 
            onPress={() => {
              setIsSignUpMode(!isSignUpMode);
              setUserId(''); setPassword(''); setName('');
            }}
          >
            <Text style={styles.switchButtonText}>
              {isSignUpMode ? "이미 계정이 있으신가요? 로그인하기" : "아직 회원이 아니신가요? 회원가입하기"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}