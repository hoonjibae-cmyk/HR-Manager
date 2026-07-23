#!/usr/bin/env bash
# GitHub Codespaces 최초 실행 시 자동 설정 스크립트
set -e

echo "▶ 1/4 의존성 설치..."
npm install

echo "▶ 2/4 PDF용 Chromium 설치..."
npx playwright install --with-deps chromium || npx playwright install chromium || true

echo "▶ 3/4 환경변수 파일 준비..."
[ -f .env ] || cp .env.example .env

echo "▶ 4/4 데이터베이스 생성 및 기초 데이터 시딩..."
npm run db:push
npm run seed

echo ""
echo "✅ 준비 완료!  아래 명령으로 실행하세요:"
echo "   npm run dev"
echo "   → 포트 3000이 자동으로 열립니다. 로그인 비밀번호: yoossam2025"
