import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listClassesForTimetable, listTutoringSlotsForTimetable } from '@/lib/services/timetableService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const [classes, tutoringSlots] = await Promise.all([listClassesForTimetable(), listTutoringSlotsForTimetable()]);
  return NextResponse.json({ classes, tutoringSlots });
}
