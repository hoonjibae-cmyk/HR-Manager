#!/usr/bin/env bash
# GitHub Codespaces 최초 실행 시 자동 설정 (Supabase 사용 — 로컬 DB 불필요)
set -e

echo "▶ 의존성 설치..."
npm install

# 환경변수 파일 준비 (없을 때만)
[ -f .env ] || cp .env.example .env

echo ""
echo "✅ 준비 완료!  다음 순서로 진행하세요:"
echo "   1) 왼쪽에서 .env 파일을 열어 Supabase 연결정보(DATABASE_URL, DIRECT_URL)를 입력"
echo "   2) npx prisma db push && npm run seed"
echo "   3) npm run dev   (로그인 비밀번호: .env 의 ADMIN_PASSWORD, 기본 yoossam2025)"
echo ""
echo "   ※ 문서 PDF는 Vercel 배포 환경에서 자동 동작합니다."
echo "     Codespaces에서 PDF까지 테스트하려면: sudo apt-get install -y chromium"
