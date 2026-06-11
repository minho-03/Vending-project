import { StyleSheet } from 'react-native';

export default StyleSheet.create({
  loginContainer: { flex: 1, backgroundColor: '#faf8f4', justifyContent: 'center' },
  loginContent: { padding: 32, alignItems: 'center' },
  loginLogo: { fontSize: 38, fontWeight: '900', color: '#3d2c1e', letterSpacing: -1, marginBottom: 4 },
  loginTagline: { fontSize: 13, color: '#9e8c7a', marginBottom: 28 },
  loginTitle: { fontSize: 20, fontWeight: '700', color: '#3d2c1e', alignSelf: 'flex-start', marginBottom: 16 },
  formContainer: { width: '100%', backgroundColor: '#fff', padding: 20, borderRadius: 18, borderWidth: 1, borderColor: '#ede5d8' },
  input: { backgroundColor: '#faf6f0', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 10, fontSize: 15, color: '#3d2c1e', marginBottom: 12, borderWidth: 1, borderColor: '#e8dfd4' },
  primaryButton: { backgroundColor: '#3d2c1e', paddingVertical: 15, borderRadius: 10, alignItems: 'center', marginTop: 4 },
  primaryButtonText: { color: '#faf8f4', fontSize: 15, fontWeight: '700' },
  switchButton: { marginTop: 18, alignItems: 'center' },
  switchButtonText: { color: '#9e8c7a', fontSize: 13, textDecorationLine: 'underline' },
});