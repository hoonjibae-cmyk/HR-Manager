#!/usr/bin/env bash
# GitHub Codespaces 최초 실행 시 자동 설정 스크립트
set -e

echo "▶ 1/5 시스템 패키지(PostgreSQL, Chromium) 설치..."
sudo apt-get update -qq
sudo apt-get install -y -qq postgresql chromium >/dev/null 2>&1 || \
  sudo apt-get install -y -qq postgresql chromium-browser >/dev/null 2>&1 || true

echo "▶ 2/5 로컬 PostgreSQL 준비..."
sudo service postgresql start || true
sudo -u postgres psql -tc "ALTER USER postgres PASSWORD 'postgres';" >/dev/null 2>&1 || true
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='hr'" 2>/dev/null | grep -q 1 \
  || sudo -u postgres createdb hr 2>/dev/null || true

echo "▶ 3/5 환경변수 파일 준비..."
if [ ! -f .env ]; then
  cp .env.example .env
  # Codespaces 는 로컬 Postgres 로 연결 (프로덕션은 Supabase URL 로 교체)
  sed -i 's#^DATABASE_URL=.*#DATABASE_URL="postgresql://postgres:postgres@localhost:5432/hr?schema=public"#' .env
  sed -i 's#^DIRECT_URL=.*#DIRECT_URL="postgresql://postgres:postgres@localhost:5432/hr?schema=public"#' .env
fi

echo "▶ 4/5 의존성 설치..."
npm install

echo "▶ 5/5 데이터베이스 스키마 생성 및 시딩..."
npm run db:push
npm run seed

echo ""
echo "✅ 준비 완료!  실행:  npm run dev"
echo "   → 포트 3000이 열립니다. 로그인 비밀번호: yoossam2025"
