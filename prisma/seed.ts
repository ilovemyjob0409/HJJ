import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import bcrypt from 'bcryptjs';

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./prisma/dev.db',
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const password = await bcrypt.hash('password123', 10);

  const admin = await prisma.user.create({
    data: { email: 'admin@example.com', password, name: '行政人員', role: 'ADMIN' },
  });

  const teacherUser = await prisma.user.create({
    data: { email: 'teacher@example.com', password, name: '王老師', role: 'TEACHER' },
  });
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, subjects: '數學', phone: '0900000000' },
  });

  const studentUser = await prisma.user.create({
    data: { email: 'student@example.com', password, name: '小明', role: 'STUDENT' },
  });
  const student = await prisma.student.create({
    data: { userId: studentUser.id, parentPhone: '0911111111' },
  });

  const classA = await prisma.class.create({
    data: {
      name: '數學A班',
      subject: '數學',
      level: '國一',
      teacherId: teacher.id,
      weekday: 1,
      startTime: '19:00',
      endTime: '21:00',
    },
  });

  await prisma.classEnrollment.create({
    data: { studentId: student.id, classId: classA.id },
  });

  await prisma.teacherAvailability.create({
    data: { teacherId: teacher.id, weekday: 3, startTime: '16:00', endTime: '18:00' },
  });

  console.log('Seed complete:', { admin: admin.email, teacher: teacherUser.email, student: studentUser.email });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
