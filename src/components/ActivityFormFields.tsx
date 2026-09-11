'use client';

import { useState } from 'react';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Select from '@/components/ui/Select';

export interface ActivityFormValues {
  title: string;
  description: string;
  categoryId: string;
  location: string;
  startDate: string;
  endDate: string;
  capacity: string;
  teacherIds: string[];
}

export const EMPTY_ACTIVITY_FORM: ActivityFormValues = {
  title: '',
  description: '',
  categoryId: '',
  location: '',
  startDate: '',
  endDate: '',
  capacity: '20',
  teacherIds: [],
};

interface ActivityFormFieldsProps {
  values: ActivityFormValues;
  onChange: (values: ActivityFormValues) => void;
  categories: { id: string; name: string }[];
  teachers: { id: string; user: { name: string } }[];
}

// 新增／編輯活動共用的欄位組——不含照片區（相簿在詳情彈窗管理）與送出鈕。
export default function ActivityFormFields({ values, onChange, categories, teachers }: ActivityFormFieldsProps) {
  const [teacherPickerOpen, setTeacherPickerOpen] = useState(false);

  function toggleTeacher(teacherId: string) {
    onChange({
      ...values,
      teacherIds: values.teacherIds.includes(teacherId)
        ? values.teacherIds.filter((id) => id !== teacherId)
        : [...values.teacherIds, teacherId],
    });
  }

  return (
    <>
      <Input placeholder="標題" value={values.title} onChange={(e) => onChange({ ...values, title: e.target.value })} required />
      <Textarea
        placeholder="描述"
        value={values.description}
        onChange={(e) => onChange({ ...values, description: e.target.value })}
        rows={3}
        required
      />
      <Select value={values.categoryId} onChange={(e) => onChange({ ...values, categoryId: e.target.value })} required>
        <option value="">請選擇分類</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Input placeholder="地點（選填）" value={values.location} onChange={(e) => onChange({ ...values, location: e.target.value })} />
      <Input type="date" value={values.startDate} onChange={(e) => onChange({ ...values, startDate: e.target.value })} required />
      <Input type="date" value={values.endDate} onChange={(e) => onChange({ ...values, endDate: e.target.value })} required />
      <Input
        type="number"
        min="1"
        placeholder="人數上限"
        value={values.capacity}
        onChange={(e) => onChange({ ...values, capacity: e.target.value })}
        required
      />
      <div>
        <button
          type="button"
          className="flex w-full items-center justify-between text-sm font-medium text-ink"
          onClick={() => setTeacherPickerOpen((open) => !open)}
        >
          <span>
            帶領老師（至少選 1 位{values.teacherIds.length > 0 ? `，已選 ${values.teacherIds.length} 位` : ''}）
          </span>
          <span className="text-xs text-inkMuted">{teacherPickerOpen ? '收合' : '展開'}</span>
        </button>
        {teacherPickerOpen && (
          <div className="mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-borderStrong p-2">
            {teachers.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={values.teacherIds.includes(t.id)} onChange={() => toggleTeacher(t.id)} />
                {t.user.name}
              </label>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
