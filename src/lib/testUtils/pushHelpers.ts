import { prisma } from '@/lib/db';

let counter = 0;

// 測試用：給學生（以 Student.id）建立一筆推播訂閱，模擬「已開啟通知」。
export async function subscribeStudentForTest(studentId: string): Promise<void> {
  const { userId } = await prisma.student.findUniqueOrThrow({
    where: { id: studentId },
    select: { userId: true },
  });
  counter += 1;
  await prisma.pushSubscription.create({
    data: { userId, endpoint: `https://push.example/test-${counter}`, p256dh: 'test-p256dh', auth: 'test-auth' },
  });
}
