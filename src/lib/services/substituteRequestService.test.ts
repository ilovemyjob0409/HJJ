import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createClass } from './classService';
import { createSubstituteRequest, listPendingSubstituteRequests, assignSubstituteTeacher } from './substituteRequestService';

beforeEach(async () => {
  await prisma.substituteRequest.deleteMany();
  await prisma.makeupRequest.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.teacherAvailability.deleteMany();
  await prisma.classEnrollment.deleteMany();
  await prisma.class.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
});

describe('createSubstituteRequest / listPendingSubstituteRequests', () => {
  it('creates a request with status PENDING_ASSIGNMENT and lists it', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });

    const req = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(2026, 6, 20), reason: '出差' });
    expect(req.status).toBe('PENDING_ASSIGNMENT');

    const pending = await listPendingSubstituteRequests();
    expect(pending.map((p) => p.id)).toContain(req.id);
  });
});

describe('assignSubstituteTeacher', () => {
  it('assigns a substitute teacher and marks the request ASSIGNED', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
    const substitute = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const req = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(2026, 6, 20), reason: '出差' });

    const updated = await assignSubstituteTeacher(req.id, substitute.id);
    expect(updated.status).toBe('ASSIGNED');
    expect(updated.substituteTeacherId).toBe(substitute.id);

    const pending = await listPendingSubstituteRequests();
    expect(pending.map((p) => p.id)).not.toContain(req.id);
  });
});
