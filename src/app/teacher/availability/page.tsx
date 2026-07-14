'use client';

import { useEffect, useState } from 'react';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface Window {
  weekday: number;
  startTime: string;
  endTime: string;
}

export default function AvailabilityPage() {
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
    load();
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">我的每週可補課時段</h1>
      <div className="flex flex-col gap-2">
        {windows.map((w, i) => (
          <div key={i} className="flex items-center gap-2">
            <select className="border p-2" value={w.weekday} onChange={(e) => updateWindow(i, { weekday: Number(e.target.value) })}>
              {WEEKDAYS.map((label, idx) => (
                <option key={idx} value={idx}>週{label}</option>
              ))}
            </select>
            <input className="border p-2" type="time" value={w.startTime} onChange={(e) => updateWindow(i, { startTime: e.target.value })} />
            <input className="border p-2" type="time" value={w.endTime} onChange={(e) => updateWindow(i, { endTime: e.target.value })} />
            <button className="text-red-600" onClick={() => removeWindow(i)}>刪除</button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button className="border p-2" onClick={addWindow}>新增時段</button>
        <button className="bg-black p-2 text-white" onClick={save}>儲存</button>
      </div>
    </div>
  );
}
