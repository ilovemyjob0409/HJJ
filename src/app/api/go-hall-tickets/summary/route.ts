import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listStudentTicketSummaries } from '@/lib/services/goHallTicketService';
import { listClassQuotaSummaries, type ClassQuotaSummaryRow } from '@/lib/services/attendanceService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const [summaries, quotas] = await Promise.all([listStudentTicketSummaries(), listClassQuotaSummaries()]);
  const quotasByStudentId = new Map<string, ClassQuotaSummaryRow[]>();
  for (const q of quotas) {
    const list = quotasByStudentId.get(q.studentId) ?? [];
    list.push(q);
    quotasByStudentId.set(q.studentId, list);
  }
  return NextResponse.json(summaries.map((s) => ({ ...s, classQuotas: quotasByStudentId.get(s.id) ?? [] })));
}
