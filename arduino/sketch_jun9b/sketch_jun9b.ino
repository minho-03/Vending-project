#include <Servo.h>

Servo rightServo; // 오른쪽 모터 (보라색 동그라미)
Servo leftServo;  // 왼쪽 모터 (보라색 네모)

int rightServoPin = 10; // 오른쪽 10번 핀
int leftServoPin = 9;   // 왼쪽 9번 핀 (원하는 핀으로 변경 가능)

void setup() {
  rightServo.attach(rightServoPin); 
  leftServo.attach(leftServoPin);
  
  // 초기 위치 설정 (오른쪽이 100도 부근이라면 왼쪽은 대칭인 80도 부근이 됩니다)
  rightServo.write(100);         
  leftServo.write(180 - 100); // 자동으로 80도로 초기화됨
  delay(1000);              
}

// 📌 [오른쪽 모터] 부드럽게 이동시키는 함수 (기존과 동일)
void moveRightServo(int startAngle, int targetAngle) {
  if (startAngle < targetAngle) {
    for (int angle = startAngle; angle <= targetAngle; angle++) {
      rightServo.write(angle);
      delay(44); 
    }
  } else {
    for (int angle = startAngle; angle >= targetAngle; angle--) {
      rightServo.write(angle);
      delay(44);
    }
  }
}

// 📌 [왼쪽 모터] 정반대로 부드럽게 이동시키는 함수
// 입력은 오른쪽과 똑같이 넣어도, 내부에서 '180 - 각도'로 뒤집어서 작동합니다.
void moveLeftServo(int startAngle, int targetAngle) {
  int realStart = 180 - startAngle;   // 시작 각도 반전
  int realTarget = 180 - targetAngle; // 목표 각도 반전

  if (realStart < realTarget) {
    for (int angle = realStart; angle <= realTarget; angle++) {
      leftServo.write(angle);
      delay(44); 
    }
  } else {
    for (int angle = realStart; angle >= realTarget; angle--) {
      leftServo.write(angle);
      delay(44);
    }
  }
}

void loop() {
  // ==========================================
  // [1단계] 오른쪽 자판기 테스트 동작 (기존 코드와 동일)
  // ==========================================
  moveRightServo(100, 170);
  delay(1000); 

  moveRightServo(180, 0);
  delay(1000);

  moveRightServo(0, 100);
  delay(3000); // 다음 테스트를 위해 잠시 대기


  // ==========================================
  // [2단계] 왼쪽 자판기 테스트 동작
  // 오른쪽 모터와 "완전히 똑같은 숫자"를 넣어도 반대로 알아서 잘 움직입니다!
  // ==========================================
  moveLeftServo(100, 170); // 실제로는 80도에서 10도로 반대로 움직임
  delay(1000); 

  moveLeftServo(180, 0);   // 실제로는 0도에서 180도로 반대로 움직임
  delay(1000);

  moveLeftServo(0, 100);  // 실제로는 180도에서 80도로 반대로 움직임
  
  // 전체 다 끝난 후 5초 쉬고 무한 반복
  delay(5000); 
}