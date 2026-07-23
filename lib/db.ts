import { PrismaClient } from "@prisma/client";

// Next.js dev 모드에서 HMR 시 PrismaClient 중복 생성을 방지하기 위한 싱글턴
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
