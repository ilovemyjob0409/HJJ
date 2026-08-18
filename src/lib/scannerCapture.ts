// 掃碼點名的按鍵重建：以 keydown 的 e.code（實體按鍵）而非 e.key 判讀。
// 中文輸入法開啟時 e.key 會變成 'Process'（字元被輸入法攔去組字），但
// e.code 不受影響，所以用 e.code 重建代碼可以讓掃碼在任何輸入法下都有效。
// 學號一律是大寫英數（正式站實查無小寫、無符號），字母固定回大寫——
// 這同時涵蓋掃碼槍用 Shift 或 CapsLock 送大寫的兩種硬體行為。

const LETTER = /^Key([A-Z])$/;
const DIGIT = /^(?:Digit|Numpad)(\d)$/;

export function charFromKeyCode(code: string): string | null {
  const letter = LETTER.exec(code);
  if (letter) return letter[1];
  const digit = DIGIT.exec(code);
  if (digit) return digit[1];
  return null;
}

export function isSubmitKeyCode(code: string): boolean {
  return code === 'Enter' || code === 'NumpadEnter';
}
