'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface Window {
  weekday: number;
  startTime: string;
  endTime: string;
}

export default function AvailabilityPage() {
  const { showToast } = useToast();
  const [windows, setWindows] = useState<Window[]>([]);

  async function load() {
    const res = await fetch('/api/availability');
    setWindows(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  function addWindow() {
    setWindows([...windows, { weekday: 1, startTime: '16:00', endTime: '18:00' }]);
  }

  function updateWindow(index: number, patch: Partial<Window>) {
    setWindows(windows.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }

  function removeWindow(index: number) {
    setWindows(windows.filter((_, i) => i !== index));
  }

  async function save() {
    await fetch('/api/availability', { method: 'PUT', body: JSON.stringify({ windows }) });
    showToast('已儲存');
    load();
  }

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">我的每週可補課時段</h1>
      <Card className="max-w-lg">
        <div className="flex flex-col gap-2">
          {windows.map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select value={w.weekday} onChange={(e) => updateWindow(i, { weekday: Number(e.target.value) })}>
                {WEEKDAYS.map((label, idx) => (
                  <option key={idx} value={idx}>
                    週{label}
                  </option>
                ))}
              </Select>
              <Input type="time" value={w.startTime} onChange={(e) => updateWindow(i, { startTime: e.target.value })} />
              <Input type="time" value={w.endTime} onChange={(e) => updateWindow(i, { endTime: e.target.value })} />
              <button className="text-rejected" onClick={() => removeWindow(i)}>
                刪除
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" onClick={addWindow}>
            新增時段
          </Button>
          <Button onClick={save}>儲存</Button>
        </div>
      </Card>
    </>
  );
}
